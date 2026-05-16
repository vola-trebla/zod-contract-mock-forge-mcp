---
title: "Stop Copy-Pasting Zod Schemas to ChatGPT. Build a Mock Forge Instead."
published: false
description: "How to use an MCP server to give your AI agents the power to read Zod schemas, generate valid mocks, and execute deep boundary violation testing automatically."
tags: "zod, testing, typescript, mcp, ai"
cover_image: ""
---

If you are using Zod for API contract validation in TypeScript, you already know the pain of writing test data. 

You have a schema with 50 nested fields, UUIDs, enums, and email constraints. When it's time to write tests, what do you do? You copy the schema, paste it into Claude or ChatGPT, and ask: *"Generate a valid JSON mock for this."*

Then you need negative tests. So you ask: *"Now generate 10 invalid payloads that break different constraints."*

Then you need a Playwright test. *"Now write a Playwright script that sends this payload."*

It works, but it's tedious. You are acting as a human clipboard between your IDE and the AI.

**What if the AI could just read your files, generate the mocks, and scaffold the tests on its own?**

Enter the **Model Context Protocol (MCP)**. 

---

## What is an MCP Server?

The Model Context Protocol allows AI agents (like Claude Desktop or Cursor) to interact with local tools and data sources. Instead of you pasting data *to* the AI, the AI fetches data *from* your environment using defined tools.

I built the [**zod-contract-mock-forge-mcp**](https://github.com/vola-trebla/zod-contract-mock-forge-mcp) to solve the exact problem of API contract testing. It bridges the gap between your Zod schemas and your testing frameworks.

---

## The "Mock Forge" Arsenal

When you connect this MCP server to Claude Desktop, the AI suddenly gains a powerful set of tools:

### 1. File Discovery (`read_schema_from_file`)
Instead of pasting code, you tell the AI: *"Look at `user.schema.ts`."*
The server automatically parses the file, extracts the specific Zod export, and feeds it to the AI. No manual copying.

### 2. Deterministic Mocking (`generate_valid_mock`)
Need test data? The server leverages `@anatine/zod-mock` and Faker.js to generate valid, realistic JSON payloads on the fly. You get actual UUIDs, formatted emails, and structurally perfect objects.

### 3. Deep Boundary Violations (`generate_boundary_violations`)
This is the killer feature for QA and SDETs. 
Simple mock generators can give you valid data, but testing requires *invalid* data. The server performs **recursive deep mutation** on your schema. It will traverse deep nested objects and arrays to intentionally:
- Omit required fields.
- Inject type mismatches (e.g., sending a number instead of a string).
- Break string constraints (invalid emails, bad UUIDs, wrong URLs).
- Violate number and array boundaries (min/max).

The AI can generate a suite of 20 negative test cases in seconds, targeting specific edge cases you might not have thought of.

### 4. Test Scaffolding (`scaffold_api_contract_test`)
Once the mocks are ready, the AI can use this tool to generate the actual test boilerplate. It supports:
- **Playwright** (for E2E API tests)
- **Jest / Vitest** (for unit testing contracts)
- **MSW** (Mock Service Worker, for frontend mocking)

### 5. The Smart Fixer (`suggest_contract_fix`)
Tests failing? Hand the failing payload and the schema to the `suggest_contract_fix` tool. It analyzes the Zod validation error and tells you exactly what went wrong:
*"Issue: Expected string, received null at `user.profile.avatar`. Fix: Make the schema `.nullable()` or ensure the payload provides a string."*

---

## The Workflow in Action

Here is what it looks like when you use an AI agent equipped with the Zod Mock Forge:

**You:** *"Read the `CreateOrder` schema from `src/schemas/order.ts` and write a Playwright negative test suite testing all boundary violations."*

**The AI (automatically):**
1. Calls `read_schema_from_file` to get the Zod code.
2. Calls `generate_boundary_violations` to get 15 different ways to break the payload.
3. Calls `scaffold_api_contract_test` to get the Playwright boilerplate.
4. Writes out a complete `order-negative.spec.ts` file with 15 distinct `test()` blocks, each asserting the correct 400 Bad Request response.

Zero copy-pasting. Complete test coverage. 

---

## Stop being a clipboard

AI agents are meant to automate tasks, not just generate text. By equipping them with MCP servers like the Zod Contract Mock Forge, you turn a chat interface into a fully automated QA engineer.

Try it out on your own projects:
[**vola-trebla/zod-contract-mock-forge-mcp**](https://github.com/vola-trebla/zod-contract-mock-forge-mcp)

Configure it in your Claude Desktop, point it at your `.ts` files, and watch it forge your tests.
