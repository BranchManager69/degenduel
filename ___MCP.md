# Comprehensive Guide: Building the DegenDuel MCP Server (SSE)

## 1. Introduction & Goal

This guide provides a detailed walkthrough for developing the DegenDuel MCP server using the Server-Sent Events (SSE) transport protocol. The goal is a secure, scalable server exposing backend functionalities as tools consumable by Cursor and other MCP clients via `https://mcp.degenduel.me/sse` (or your chosen URL).

## 2. Core Technology Stack (Example: Node.js/TypeScript)

While adaptable to any backend language, this guide uses Node.js/TypeScript concepts for illustration due to likely alignment with your frontend stack.

*   **Web Framework:** Express.js (or Koa, Fastify) for handling HTTP requests and routing.
*   **SSE Library:** Middleware like `sse-express` or building upon native Node.js `http` module capabilities.
*   **Authentication:** Middleware using libraries like `jsonwebtoken` (if using JWTs internally for keys) or direct database lookups for API keys.
*   **Database Access:** Your existing ORM or database client (e.g., Prisma, TypeORM, node-postgres).
*   **Image Generation (Optional):** Libraries like `node-canvas` (for Chart.js server-side), `sharp` (image manipulation), `qrcode` (QR codes).

## 3. Detailed Implementation Steps

### Step 3.1: Setting Up the SSE Server Endpoint (`/sse`)

*   **Action:** Create an HTTP server and define the `/sse` route.
*   **Details:**
    *   Initialize your web framework (e.g., Express).
    *   Define a route handler for `GET /sse`.
    *   **Crucially:** Inside this handler, perform Authentication **first** (see Step 3.5). If authentication fails, **immediately** return an error (e.g., 401/403) and **do not** proceed to establish the SSE connection.
    *   If authentication succeeds:
        *   Set appropriate HTTP headers for SSE:
            ```http
            Content-Type: text/event-stream
            Cache-Control: no-cache
            Connection: keep-alive
            ```
        *   Keep the connection open. Do *not* call `res.end()` immediately.
        *   Store the `response` object (or a dedicated SSE client object) associated with the authenticated user/API key. This allows you to send events to this specific client later.
        *   Send the initial MCP `server_info` event (see Step 3.2).
        *   Implement heartbeat mechanism: Send periodic SSE comments (lines starting with `:`) or dummy events (`event: heartbeat
data: {}

`) to keep the connection alive through proxies and detect disconnects.
        *   Handle client disconnects gracefully (e.g., using `req.on('close', ...)` in Express) to clean up resources associated with the connection.

### Step 3.2: Implementing MCP Protocol over SSE

*   **Action:** Send and receive messages formatted according to MCP specification via SSE events.
*   **Key SSE Event Format:**
    ```sse
    id: <unique_event_id>  # Optional but recommended
    event: <mcp_message_type>
    data: <json_payload_string>
    


    ```
*   **Messages to Send (Server -> Client):**
    *   **`server_info` (Immediately after successful auth on `/sse`):** Informs the client about the server.
        ```json
        // data payload example
        {
          "protocol_version": "0.1", // Check current MCP spec version
          "server_name": "DegenDuel MCP",
          "tools": [
            // Array of tool definition objects (see below)
          ]
        }
        ```
    *   **Tool Definition Object:** Describes a single tool.
        ```json
        {
          "tool_name": "get_duel_status",
          "description": "Fetches the current status of a specific duel.",
          "parameters": {
            "type": "object",
            "properties": {
              "duel_id": { "type": "string", "description": "The unique ID of the duel." }
            },
            "required": ["duel_id"]
          }
        }
        ```
        *(Note: Parameter format uses JSON Schema conventions)*
    *   **`tool_response` (In response to a `tool_request`):** Sends the result of a tool execution.
        ```json
        // data payload example for successful execution
        {
          "request_id": "client_provided_request_id", // Echo the request ID
          "tool_name": "get_duel_status",
          "status": "success",
          "content": [
            { "type": "text", "text": "Duel Status:" },
            { "type": "json", "json": { "status": "active", "pot": 100, "participants": 5 } }
            // OR for image tools (see Step 3.7)
            // { "type": "image", "data": "base64string", "mimeType": "image/png" }
          ]
        }

        // data payload example for failed execution
        {
          "request_id": "client_provided_request_id",
          "tool_name": "get_duel_status",
          "status": "error",
          "error": {
             "code": "DUEL_NOT_FOUND", // Or other specific codes
             "message": "Could not find a duel with the specified ID."
          }
        }
        ```
*   **Messages to Receive (Client -> Server):**
    *   **Note:** SSE is primarily server-to-client. Clients typically send requests via standard HTTP POST/PUT requests to *separate* endpoints on your server, not directly back over the SSE stream itself. The MCP specification likely defines how clients signal tool execution requests. A common pattern is:
        1. Client connects to `/sse` and receives tool definitions.
        2. When the user asks Cursor to run a tool, Cursor sends a standard HTTP POST request to another endpoint (e.g., `/mcp/execute_tool`) on your server.
        3. This POST request body contains the `tool_request` payload (including `request_id`, `tool_name`, `parameters`).
        4. Your server handles this POST request, authenticates it (again!), executes the tool, and then sends the `tool_response` *back over the persistent `/sse` connection* associated with that authenticated client, using the `request_id` from the POST request.
    *   **`tool_request` (Received via HTTP POST, e.g., `/mcp/execute_tool`):**
        ```json
        // Example POST request body
        {
          "request_id": "unique_client_generated_id",
          "tool_name": "get_duel_status",
          "parameters": {
            "duel_id": "some-duel-identifier-123"
          }
        }
        ```

### Step 3.3: Tool Implementation Logic

*   **Action:** Write the actual code for each tool function.
*   **Details:**
    *   Create functions (e.g., `handleGetDuelStatus(params)`).
    *   These functions receive the validated parameters from the `tool_request`.
    *   Securely interact with your database and internal services.
    *   Perform necessary DegenDuel game logic.
    *   Format the successful result or error details.
    *   Return the result to the main request handler so it can be packaged into a `tool_response` SSE event.
    *   **Crucially:** Implement thorough error handling within each tool function. Catch database errors, validation errors, permission errors, etc., and translate them into meaningful MCP error responses.

### Step 3.4: HTTPS/SSL & DNS

*   **Action:** Ensure secure HTTPS connection and proper DNS setup.
*   **Details:** Follow the steps outlined in the previous plan (Section 4.4 & 4.3), prioritizing Cloudflare Proxy ON initially for ease of SSL management and security benefits. Ensure your MCP server application is configured to listen for HTTPS connections if terminating SSL directly, or HTTP if behind a reverse proxy like Cloudflare or Nginx that handles SSL.

### Step 3.5: Robust Authentication (API Key Bearer Token)

*   **Action:** Implement and enforce API key authentication for *all* MCP-related requests.
*   **Details:**
    *   **`/sse` Endpoint Middleware:**
        *   Extract `Authorization` header.
        *   Check format: `Bearer <key>`.
        *   Validate key against your secure user/API key store.
        *   If invalid, return `401 Unauthorized` or `403 Forbidden` immediately.
        *   If valid, store the associated user ID/context with the SSE connection object.
    *   **`/mcp/execute_tool` (or similar) Endpoint Middleware:**
        *   Repeat the same `Authorization: Bearer <key>` validation for the incoming POST request.
        *   Ensure the authenticated user has permission to execute the requested tool with the given parameters. Return `403 Forbidden` if not.
        *   Only proceed to execute the tool if authentication and authorization succeed.

### Step 3.6: Error Handling & Logging

*   **Action:** Implement comprehensive error handling and logging.
*   **Details:**
    *   **Server Errors:** Handle internal server errors (5xx) gracefully. Send a generic MCP error response without revealing sensitive details. Log the full error server-side.
    *   **Tool Errors:** Catch specific errors within tool logic (invalid input, not found, permissions) and return structured MCP errors (4xx type issues) with codes and messages as shown in the `tool_response` error example.
    *   **Authentication Errors:** Handled by middleware, returning 401/403.
    *   **Logging:** Log connection attempts (success/fail), authentication results, tool requests (tool name, parameters *without sensitive data*), tool responses (success/error status), and any internal errors.

### Step 3.7: Image Generation Tool Implementation (Example)

*   **Action:** Implement tools that return images.
*   **Details:**
    *   **Generate Image:** Use server-side libraries to create the image (chart, QR code) as a buffer.
    *   **Encode:** Convert the buffer to a base64 string.
    *   **Format Response:** Create the `tool_response` `content` array with an object like:
        ```json
        {
          "type": "image",
          "data": "YOUR_BASE64_ENCODED_IMAGE_STRING",
          "mimeType": "image/png" // Match the actual image type
        }
        ```
    *   Send this response back via the SSE connection.

### Step 3.8: Testing Strategies

*   **Action:** Thoroughly test the implementation.
*   **Details:**
    *   **Unit Tests:** Test individual tool functions and authentication logic in isolation.
    *   **Integration Tests:** Test the interaction between the HTTP framework, SSE handling, auth middleware, and tool functions.
    *   **Manual SSE Client:** Use tools like `curl` or browser developer console JavaScript (`new EventSource('/sse', { headers: { 'Authorization': 'Bearer YOUR_KEY' } })`) to connect to `/sse` and observe the `server_info` event and heartbeats.
    *   **Manual POST Client:** Use tools like `curl`, Postman, or Insomnia to send test POST requests to your `/mcp/execute_tool` endpoint (with the `Authorization` header) and then check your manual SSE client connection for the corresponding `tool_response` event.
    *   **Cursor Testing:** Finally, configure Cursor with the server URL and test tool execution directly within the chat interface.

## 4. Deployment & Maintenance

*   Deploy the MCP server application alongside your main backend using your standard, secure deployment practices.
*   Monitor server logs, performance, and error rates.
*   Keep dependencies (OS, language runtime, libraries) updated.
*   Have a plan for API key revocation and rotation.
*   Version your MCP tools if you introduce breaking changes.
