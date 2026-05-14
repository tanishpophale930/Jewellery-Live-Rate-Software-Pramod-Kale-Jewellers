package com.prk.prklivesoftwarebackend.Exception;

import java.net.URI;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(UpstreamGoldRateException.class)
    public ResponseEntity<ProblemDetail> handleUpstreamGoldRateException(
            UpstreamGoldRateException exception,
            ServletWebRequest request) {
        ProblemDetail problemDetail = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_GATEWAY,
                exception.getMessage());
        problemDetail.setTitle("Unable to fetch gold rate");
        problemDetail.setType(URI.create("urn:prk:error:upstream-gold-rate"));
        problemDetail.setProperty("timestamp", OffsetDateTime.now());
        problemDetail.setProperty("path", request.getRequest().getRequestURI());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(problemDetail);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleUnexpectedException(
            Exception exception,
            ServletWebRequest request) {
        log.error("Unhandled exception while serving {}", request.getRequest().getRequestURI(), exception);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("timestamp", OffsetDateTime.now());
        payload.put("status", HttpStatus.INTERNAL_SERVER_ERROR.value());
        payload.put("error", HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase());
        payload.put("message", "An unexpected internal error occurred");
        payload.put("path", request.getRequest().getRequestURI());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(payload);
    }
}
