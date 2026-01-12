# Vulcan MCP Setup

Configure your tenant by running: `wrangler kv key put "tenant:YOUR_TENANT_ID" --value '{"VULCAN_BASE_URL":"https://your-vulcan-api.com"}' --namespace-id 749180a6a34a40ddac2dabd159c982fa --remote`

Then connect to: `https://mcp.vulcan.io/mcp/YOUR_TENANT_ID` in your MCP client (e.g., Claude Desktop config).

