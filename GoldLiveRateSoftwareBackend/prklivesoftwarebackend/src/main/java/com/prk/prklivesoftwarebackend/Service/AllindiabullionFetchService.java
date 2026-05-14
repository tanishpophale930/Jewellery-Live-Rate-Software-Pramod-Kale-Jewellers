package com.prk.prklivesoftwarebackend.Service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import com.prk.prklivesoftwarebackend.Config.AibProperties;
import com.prk.prklivesoftwarebackend.Exception.UpstreamGoldRateException;

import reactor.util.retry.Retry;

@Service
public class AllindiabullionFetchService {

    private static final Logger log = LoggerFactory.getLogger(AllindiabullionFetchService.class);
    private static final Pattern RETAIL_995_PATTERN = Pattern.compile(
            "\\bRETAIL\\s+995\\b.*?₹\\s*([0-9,]+)",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );

    private final WebClient webClient;
    private final AibProperties props;
    private final Object cacheLock = new Object();
    private volatile CachedRetail995 cachedRetail995;

    public AllindiabullionFetchService(WebClient webClient, AibProperties props) {
        this.webClient = webClient;
        this.props = props;
    }

    public BigDecimal fetchRetail995() {
        CachedRetail995 cacheSnapshot = cachedRetail995;
        if (cacheSnapshot != null && !cacheSnapshot.isExpired(props.cacheTtlSeconds())) {
            return cacheSnapshot.price();
        }

        synchronized (cacheLock) {
            cacheSnapshot = cachedRetail995;
            if (cacheSnapshot != null && !cacheSnapshot.isExpired(props.cacheTtlSeconds())) {
                return cacheSnapshot.price();
            }

            try {
                BigDecimal latestPrice = fetchRetail995FromUpstream();
                cachedRetail995 = new CachedRetail995(latestPrice, Instant.now());
                return latestPrice;
            } catch (UpstreamGoldRateException exception) {
                if (cacheSnapshot != null && cacheSnapshot.isUsableAsStaleFallback(props.staleIfErrorSeconds())) {
                    log.warn("Upstream fetch failed, serving stale cached Retail 995 price", exception);
                    return cacheSnapshot.price();
                }
                throw exception;
            }
        }
    }

    BigDecimal extractRetail995Price(String html) {
        if (html == null || html.isBlank()) {
            throw new UpstreamGoldRateException("Upstream gold-rate page returned an empty response");
        }

        Document doc = Jsoup.parse(html);
        String text = doc.text().replaceAll("\\s+", " ");

        Matcher matcher = RETAIL_995_PATTERN.matcher(text);
        if (!matcher.find()) {
            throw new UpstreamGoldRateException("Retail 995 price was not found in upstream content");
        }

        return new BigDecimal(matcher.group(1).replace(",", ""));
    }

    BigDecimal fetchRetail995FromUpstream() {
        try {
            var responseMono = webClient.get()
                    .uri(props.url())
                    .accept(MediaType.TEXT_HTML)
                    .header(HttpHeaders.USER_AGENT, props.userAgent())
                    .cookie(props.cookieName(), props.cookieValue())
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(props.timeoutSeconds()));

            if (props.maxRetries() > 0) {
                responseMono = responseMono.retryWhen(
                        Retry.backoff(props.maxRetries(), Duration.ofMillis(props.retryBackoffMillis())));
            }

            String html = responseMono.block();
            BigDecimal latestPrice = extractRetail995Price(html);
            log.debug("Fetched latest Retail 995 price successfully");
            return latestPrice;
        } catch (UpstreamGoldRateException exception) {
            throw exception;
        } catch (WebClientResponseException exception) {
            log.warn("Upstream gold-rate request failed with status {}", exception.getStatusCode().value(), exception);
            throw new UpstreamGoldRateException("Upstream gold-rate service returned an error response", exception);
        } catch (WebClientRequestException exception) {
            log.warn("Upstream gold-rate request could not be completed", exception);
            throw new UpstreamGoldRateException("Upstream gold-rate service is unreachable", exception);
        } catch (RuntimeException exception) {
            log.error("Unexpected failure while fetching Retail 995 price", exception);
            throw new UpstreamGoldRateException("Unable to fetch the latest Retail 995 price", exception);
        }
    }

    private record CachedRetail995(BigDecimal price, Instant fetchedAt) {
        private boolean isExpired(long cacheTtlSeconds) {
            if (cacheTtlSeconds <= 0) {
                return true;
            }
            return fetchedAt.plusSeconds(cacheTtlSeconds).isBefore(Instant.now());
        }

        private boolean isUsableAsStaleFallback(long staleIfErrorSeconds) {
            if (staleIfErrorSeconds <= 0) {
                return false;
            }
            return fetchedAt.plusSeconds(staleIfErrorSeconds).isAfter(Instant.now());
        }
    }
}
