package probes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"dce-diag/pkg/ocp"
)

type sensorStatus struct {
	Health string `json:"Health"`
}

// SensorReading is a normalized Redfish sensor value.
type SensorReading struct {
	Name                   string       `json:"Name"`
	Reading                *float64     `json:"Reading,omitempty"`
	ReadingCelsius         *float64     `json:"ReadingCelsius,omitempty"`
	ReadingUnits           string       `json:"ReadingUnits,omitempty"`
	LowerThresholdCritical *float64     `json:"LowerThresholdCritical,omitempty"`
	UpperThresholdCritical *float64     `json:"UpperThresholdCritical,omitempty"`
	StatusHealth           string       `json:"StatusHealth,omitempty"`
	Status                 sensorStatus `json:"Status,omitempty"`
}

type thermalResponse struct {
	Temperatures []SensorReading `json:"Temperatures"`
	Fans         []SensorReading `json:"Fans"`
}

type powerResponse struct {
	PowerSupplies []SensorReading `json:"PowerSupplies"`
	Voltages      []SensorReading `json:"Voltages"`
}

// ThermalAuditDetails contains the normalized readings returned by Redfish.
type ThermalAuditDetails struct {
	Temperatures  []SensorReading `json:"temperatures"`
	Fans          []SensorReading `json:"fans"`
	PowerSupplies []SensorReading `json:"power_supplies"`
	Voltages      []SensorReading `json:"voltages"`
}

// AuditThermalSensors checks temperatures, fans, power supplies, and voltage
// rails exposed by the chassis Redfish Thermal and Power resources.
func (c *BMCClient) AuditThermalSensors() ocp.DiagnosticResult {
	return c.AuditThermalSensorsContext(context.Background())
}

// AuditThermalSensorsContext is the context-aware form of AuditThermalSensors.
func (c *BMCClient) AuditThermalSensorsContext(ctx context.Context) ocp.DiagnosticResult {
	result := ocp.DiagnosticResult{
		TestName:  "Thermal_Sensors_Check",
		Timestamp: time.Now().UTC(),
	}
	if c == nil {
		result.Status = ocp.StatusCannotRun
		result.FailureReason = "BMC client is not configured"
		return result
	}

	chassisID := c.ChassisID
	if chassisID == "" {
		chassisID = "chassis"
	}
	basePath := "/redfish/v1/Chassis/" + url.PathEscape(chassisID)

	var thermal thermalResponse
	if err := c.getRedfishJSON(ctx, basePath+"/Thermal", &thermal); err != nil {
		result.Status = ocp.StatusCannotRun
		result.FailureReason = fmt.Sprintf("failed to query Redfish thermal endpoint: %v", err)
		return result
	}

	var power powerResponse
	if err := c.getRedfishJSON(ctx, basePath+"/Power", &power); err != nil {
		result.Status = ocp.StatusCannotRun
		result.FailureReason = fmt.Sprintf("failed to query Redfish power endpoint: %v", err)
		return result
	}

	details := ThermalAuditDetails{
		Temperatures:  thermal.Temperatures,
		Fans:          thermal.Fans,
		PowerSupplies: power.PowerSupplies,
		Voltages:      power.Voltages,
	}
	result.Details = details

	for _, group := range [][]SensorReading{details.Temperatures, details.Fans, details.PowerSupplies, details.Voltages} {
		for _, sensor := range group {
			if reason := sensorFailure(sensor); reason != "" {
				result.Status = ocp.StatusFail
				result.FRULocation = sensor.Name
				result.FailureReason = reason
				return result
			}
		}
	}

	result.Status = ocp.StatusPass
	return result
}

func (c *BMCClient) getRedfishJSON(ctx context.Context, path string, target any) error {
	if _, err := url.ParseRequestURI(c.BaseURL); err != nil {
		return fmt.Errorf("invalid BMC base URL: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.BaseURL, "/")+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if c.Username != "" || c.Password != "" {
		req.SetBasicAuth(c.Username, c.Password)
	}

	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("BMC returned %s", resp.Status)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(target); err != nil {
		return fmt.Errorf("decode Redfish response: %w", err)
	}
	return nil
}

func sensorFailure(sensor SensorReading) string {
	health := sensor.Status.Health
	if health == "" {
		health = sensor.StatusHealth
	}
	if health != "" && !strings.EqualFold(health, "OK") {
		return fmt.Sprintf("%s health is %s", sensor.Name, health)
	}

	value := sensor.Reading
	if sensor.ReadingCelsius != nil {
		value = sensor.ReadingCelsius
	}
	if value == nil {
		return ""
	}
	if sensor.LowerThresholdCritical != nil && *value <= *sensor.LowerThresholdCritical {
		return fmt.Sprintf("%s reading %.2f is at or below critical minimum %.2f", sensor.Name, *value, *sensor.LowerThresholdCritical)
	}
	if sensor.UpperThresholdCritical != nil && *value >= *sensor.UpperThresholdCritical {
		return fmt.Sprintf("%s reading %.2f is at or above critical maximum %.2f", sensor.Name, *value, *sensor.UpperThresholdCritical)
	}
	return ""
}
