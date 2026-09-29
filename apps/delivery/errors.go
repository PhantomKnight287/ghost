package main

import (
	"errors"
	"time"
)

var errLeaseLost = errors.New("lease lost")

// permanentError is a send failure that retrying cannot fix, such as a disabled endpoint. The job goes straight to dead.
type permanentError struct{ error }

// retryAfterError carries when to retry, from the receiver's Retry-After or a busy host.
type retryAfterError struct {
	error
	after time.Duration
}
