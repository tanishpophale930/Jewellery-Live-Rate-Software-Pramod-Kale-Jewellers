package com.prk.prklivesoftwarebackend.Config;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "aib")
public record AibProperties(
        @NotBlank String url,
        @NotBlank String cookieName,
        @NotBlank String cookieValue,
        @Min(1) int timeoutSeconds,
        @Min(1000) int connectTimeoutMillis,
        @Min(0) long cacheTtlSeconds,
        @Min(0) long staleIfErrorSeconds,
        @Min(0) int maxRetries,
        @Min(0) long retryBackoffMillis,
        @NotBlank String userAgent
) {
}
