# Security Policy

## Supported versions

The latest published version receives security fixes.

## Reporting a vulnerability

Please report security issues privately to contact@tuguidragos.com rather than opening a
public issue. Include a description, reproduction steps, and the affected version. You can
expect an initial response within a few business days.

## Scope

This node is a thin REST client for the IBM Quantum Platform. It ships no runtime
dependencies and stores no credentials itself. The IBM Cloud API key is held by n8n as an
encrypted credential and is exchanged for a short-lived IAM token at request time.
