# Providers

This directory contains the infrastructure provider implementations for the infra-glue CLI. The providers abstract different Infrastructure as Code (IaC) tools into a unified interface, allowing the CLI to work with multiple deployment technologies.

In the future, each provider could be developed as a separate package and integrated as a plugin.

## Overview

The providers system provides a common abstraction layer over different IaC tools. Each provider implements the `Provider` abstract class, which defines a standard interface for:

- Planning infrastructure changes
- Applying infrastructure changes
- Destroying infrastructure
- Retrieving outputs

## Architecture

### Core Components

- **`provider.ts`** - Defines the abstract `Provider` class and common types
- **`pulumi-provider.ts`** - Implementation for Pulumi infrastructure deployments
- **`terraform-provider.ts`** - Implementation for Terraform infrastructure deployments

## Testing

TODO: add simple integration tests for providers

## Future Enhancements

- [] Support for additional IaC tools (CloudFormation, CDK, etc.)
- [] Enable exporting the infrastructure plan to a file and provide an option to apply only the exported plan
