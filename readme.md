# Magicpin Vera AI Challenge

## Overview
A deterministic AI message engine built with Node.js and Express that powers Vera, Magicpin's merchant assistant.

## Tech Stack
- Node.js
- Express.js
- JavaScript (ES Modules)
- Gemini 2.5 Flash
- Railway

## Architecture
- Context Store
- Dataset Loader
- Keyword Retrieval
- Prompt Builder
- Gemini Service
- Tick Orchestrator
- Reply Engine

## Key Design Decisions
- Deterministic keyword retrieval for speed and consistency
- Prompt-driven decision making with structured JSON outputs
- Fast-path handling for auto-replies, hostile messages, and committed merchants to reduce latency and improve reliability
- Modular services with clear separation of concerns

## API Endpoints
- GET /v1/healthz
- GET /v1/metadata
- POST /v1/context
- POST /v1/tick
- POST /v1/reply

## Running Locally
npm install
npm run dev

## Deployment
Hosted on Railway.