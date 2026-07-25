package probes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// BMCClient controls a server BMC through its Redfish API.
type BMCClient struct {
	BaseURL    string
	Username   string
	Password   string
	SystemID   string
	HTTPClient *http.Client
}

// NewBMCClient creates a Redfish client for a BMC endpoint.
func NewBMCClient(baseURL, username, password, systemID string) *BMCClient {
	return &BMCClient{
		BaseURL:  strings.TrimRight(baseURL, "/"),
		Username: username,
		Password: password,
		SystemID: systemID,
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// SetLocateLED enables or disables the physical chassis identify LED.
func (c *BMCClient) SetLocateLED(enabled bool) error {
	return c.SetLocateLEDContext(context.Background(), enabled)
}

// SetLocateLEDContext is the context-aware form of SetLocateLED.
func (c *BMCClient) SetLocateLEDContext(ctx context.Context, enabled bool) error {
	if c == nil {
		return fmt.Errorf("BMC client is nil")
	}
	if _, err := url.ParseRequestURI(c.BaseURL); err != nil {
		return fmt.Errorf("invalid BMC base URL: %w", err)
	}

	systemID := c.SystemID
	if systemID == "" {
		systemID = "system"
	}

	indicator := "Off"
	if enabled {
		indicator = "Blinking"
	}
	body, err := json.Marshal(map[string]string{"IndicatorLED": indicator})
	if err != nil {
		return fmt.Errorf("encode locate LED request: %w", err)
	}

	endpoint := fmt.Sprintf("%s/redfish/v1/Systems/%s", c.BaseURL, url.PathEscape(systemID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create locate LED request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
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
		return fmt.Errorf("set locate LED: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("set locate LED: BMC returned %s", resp.Status)
	}
	return nil
}
