package com.prk.prklivesoftwarebackend.Controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.web.reactive.function.client.WebClient;

import com.prk.prklivesoftwarebackend.Config.AibProperties;
import com.prk.prklivesoftwarebackend.Service.AllindiabullionFetchService;

@SpringBootTest(properties = "AIB_TOKEN=test-token")
@AutoConfigureMockMvc
@Import(AllindiabullionFetchControllerTests.TestConfig.class)
@TestPropertySource(properties = "app.cors.allowed-origins=http://localhost:5173")
class AllindiabullionFetchControllerTests {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void retail995ReturnsExpectedPayload() throws Exception {
        mockMvc.perform(get("/api/prk/gold/retail-995"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retail995").value(12345));
    }

    @Test
    void corsHeadersAreReturnedForConfiguredOrigin() throws Exception {
        mockMvc.perform(options("/api/prk/gold/retail-995")
                        .header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }

    @TestConfiguration
    static class TestConfig {

        @Bean
        @Primary
        AllindiabullionFetchService testAllindiabullionFetchService() {
            return new AllindiabullionFetchService(
                    WebClient.builder().build(),
                    new AibProperties(
                            "https://example.com",
                            "cookie",
                            "token",
                            10,
                            5000,
                            30,
                            300,
                            2,
                            300,
                            "test-agent")) {
                @Override
                public BigDecimal fetchRetail995() {
                    return new BigDecimal("12345");
                }
            };
        }
    }
}
