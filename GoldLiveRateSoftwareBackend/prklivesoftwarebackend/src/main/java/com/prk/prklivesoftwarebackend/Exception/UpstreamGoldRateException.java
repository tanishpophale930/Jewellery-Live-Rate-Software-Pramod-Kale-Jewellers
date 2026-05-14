package com.prk.prklivesoftwarebackend.Exception;

public class UpstreamGoldRateException extends RuntimeException {

    public UpstreamGoldRateException(String message) {
        super(message);
    }

    public UpstreamGoldRateException(String message, Throwable cause) {
        super(message, cause);
    }
}
