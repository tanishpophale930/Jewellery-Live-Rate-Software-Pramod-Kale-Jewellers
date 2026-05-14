package com.prk.prklivesoftwarebackend.Service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;

import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

import com.prk.prklivesoftwarebackend.Config.AibProperties;
import com.prk.prklivesoftwarebackend.Exception.UpstreamGoldRateException;

class AllindiabullionFetchServiceTests {

    private final AllindiabullionFetchService service = new AllindiabullionFetchService(
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
                    "test-agent"));

    @Test
    void extractRetail995PriceParsesExpectedAmount() {
        String html = """
                <html>
                  <body>
                    <div>RETAIL 995</div>
                    <span>₹ 9,999</span>
                  </body>
                </html>
                """;

        BigDecimal price = service.extractRetail995Price(html);

        assertEquals(new BigDecimal("9999"), price);
    }

    @Test
    void extractRetail995PriceFailsWhenPriceIsMissing() {
        String html = "<html><body><div>No price available</div></body></html>";

        assertThrows(UpstreamGoldRateException.class, () -> service.extractRetail995Price(html));
    }

    @Test
    void fetchRetail995UsesRecentStaleCacheWhenUpstreamFails() throws InterruptedException {
        AllindiabullionFetchService cachingService = new AllindiabullionFetchService(
                WebClient.builder().build(),
                new AibProperties(
                        "https://example.com",
                        "cookie",
                        "token",
                        10,
                        5000,
                        1,
                        300,
                        2,
                        300,
                        "test-agent")) {
            private int attempts;

            @Override
            BigDecimal fetchRetail995FromUpstream() {
                attempts++;
                if (attempts == 1) {
                    return new BigDecimal("9999");
                }
                throw new UpstreamGoldRateException("upstream unavailable");
            }
        };

        assertEquals(new BigDecimal("9999"), cachingService.fetchRetail995());
        Thread.sleep(1100);
        assertEquals(new BigDecimal("9999"), cachingService.fetchRetail995());
    }
}
