package main

import (
	"errors"
	"time"
)

var errLeaseLost = errors.New("lease lost")

// permanentError is a send failure that retrying cannot fix, such as a
// disabled endpoint. The job goes straight to dead.
type permanentError struct{ error }

// retryAfterError is a send failure where the receiver said when to retry.
type retryAfterError struct {
	error
	after time.Duration
}
