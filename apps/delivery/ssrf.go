package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"
)

var errBlockedAddress = errors.New("address is not allowed for webhooks")

var (
	thisNetwork = netip.MustParsePrefix("0.0.0.0/8")
	sharedCGNAT = netip.MustParsePrefix("100.64.0.0/10")
)

// Link-local covers the cloud metadata address 169.254.169.254, so it stays blocked even when private networks are allowed.
func blocked(a netip.Addr, allowPrivate bool) bool {
	a = a.Unmap() // ::ffff:127.0.0.1 is 127.0.0.1
	if a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() || a.IsMulticast() ||
		a.IsUnspecified() || thisNetwork.Contains(a) {
		return true
	}
	if allowPrivate {
		return false
	}
	return a.IsLoopback() || a.IsPrivate() || sharedCGNAT.Contains(a)
}

// The check runs on the IP actually dialed, after DNS, so a name that rebinds to an internal address is refused. No proxy, since the check would see the proxy's IP; no redirects, since one could point anywhere.
func newWebhookClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(network, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil {
				return err
			}
			if blocked(ap.Addr(), allowPrivate) {
				return fmt.Errorf("%w: %s", errBlockedAddress, ap.Addr())
			}
			return nil
		},
	}
	return &http.Client{
		Transport: &http.Transport{
			Proxy:               nil,
			DialContext:         dialer.DialContext,
			TLSHandshakeTimeout: 5 * time.Second,
			MaxIdleConnsPerHost: 2,
			IdleConnTimeout:     90 * time.Second,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}
