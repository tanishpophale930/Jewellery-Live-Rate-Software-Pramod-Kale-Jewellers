package com.prk.prklivesoftwarebackend.Controller;

import java.math.BigDecimal;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.prk.prklivesoftwarebackend.Service.AllindiabullionFetchService;

@RestController
@RequestMapping("/api/prk")
public class AllindiabullionFetchController {

    private final AllindiabullionFetchService allindiabullionFetchService;

    public AllindiabullionFetchController(AllindiabullionFetchService allindiabullionFetchService) {
        this.allindiabullionFetchService = allindiabullionFetchService;
    }

    @GetMapping("/gold/retail-995")
    public ResponseEntity<Map<String, BigDecimal>> retail995() {
        BigDecimal price = allindiabullionFetchService.fetchRetail995();
        return ResponseEntity.ok(Map.of("retail995", price));
    }
}
