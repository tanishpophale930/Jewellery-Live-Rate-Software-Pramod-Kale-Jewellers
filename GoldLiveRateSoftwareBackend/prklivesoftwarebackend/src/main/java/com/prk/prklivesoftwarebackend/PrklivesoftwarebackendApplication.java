package com.prk.prklivesoftwarebackend;

import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@ConfigurationPropertiesScan
public class PrklivesoftwarebackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(PrklivesoftwarebackendApplication.class, args);
	}

}
