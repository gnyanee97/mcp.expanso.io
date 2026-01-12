/**
 * Chat UI for Vulcan Documentation
 * A simple web interface for chatting with the documentation
 */

export function getChatHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vulcan Docs Chat</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --surface: #141414;
      --surface-hover: #1f1f1f;
      --border: #2a2a2a;
      --text: #fafafa;
      --text-muted: #a3a3a3;
      --primary: #a78bfa;
      --primary-hover: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    header h1 { font-size: 1.25rem; font-weight: 600; }
    header a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.875rem;
    }
    header a:hover { color: var(--primary); }
    .new-chat-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
      cursor: pointer;
      margin-left: auto;
    }
    .new-chat-btn:hover {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }
    .main-container {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .chat-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
    }
    .code-panel-header {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface);
    }
    .code-panel-header h2 {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-muted);
    }
    .code-panel-header button {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      background: var(--surface-hover);
      border: 1px solid var(--border);
      cursor: pointer;
      border-radius: 0.25rem;
    }
    .code-panel-header button:hover {
      background: var(--primary);
      border-color: var(--primary);
    }
    .feedback-buttons {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .feedback-buttons button {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .feedback-buttons button.valid { color: #86efac; }
    .feedback-buttons button.invalid { color: #fca5a5; }
    .feedback-buttons button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .feedback-buttons button.submitted {
      background: var(--primary);
      border-color: var(--primary);
    }
    .feedback-label {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .code-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .code-editor {
      flex: 1;
      width: 100%;
      padding: 1.5rem;
      border: none;
      background: transparent;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 14px;
      line-height: 1.6;
      color: #f5f5f5;
      resize: none;
      outline: none;
    }
    .code-editor::placeholder {
      color: var(--text-muted);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-style: italic;
    }
    .code-editor.error-pulse {
      animation: errorPulse 0.6s ease-out;
    }
    @keyframes errorPulse {
      0% { box-shadow: inset 0 0 0 3px #ef4444; background: rgba(239, 68, 68, 0.15); }
      100% { box-shadow: none; background: transparent; }
    }
    .validation-result {
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      max-height: 180px;
      overflow-y: auto;
    }
    .validation-result.valid {
      background: rgba(34, 197, 94, 0.1);
      border-top: 2px solid #22c55e;
    }
    .validation-result.valid .validation-icon { color: #22c55e; }
    .validation-result.invalid {
      background: rgba(239, 68, 68, 0.05);
      border-top: 2px solid #ef4444;
    }
    .validation-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
      font-size: 0.85rem;
    }
    .validation-icon { font-size: 1rem; }
    .validation-header.valid { color: #86efac; }
    .validation-header.invalid { color: #fca5a5; }
    .error-item {
      display: flex;
      flex-direction: column;
      padding: 0.5rem 0.75rem;
      margin: 0.25rem 0;
      background: rgba(0,0,0,0.2);
      border-radius: 4px;
      border-left: 3px solid #ef4444;
      cursor: pointer;
      transition: background 0.15s;
    }
    .error-item:hover { background: rgba(0,0,0,0.35); }
    .error-line {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .error-line-num {
      font-family: 'SF Mono', monospace;
      font-size: 0.7rem;
      padding: 0.125rem 0.375rem;
      background: #ef4444;
      color: white;
      border-radius: 3px;
      font-weight: 600;
    }
    .error-message {
      color: #fca5a5;
      font-size: 0.8rem;
    }
    .error-suggestion {
      color: #a3a3a3;
      font-size: 0.75rem;
      margin-top: 0.25rem;
      padding-left: 0.5rem;
      border-left: 2px solid #4b5563;
    }
    .error-path {
      color: #6b7280;
      font-size: 0.7rem;
      font-family: 'SF Mono', monospace;
      margin-top: 0.25rem;
    }
    .validate-btn {
      background: var(--primary) !important;
      border-color: var(--primary) !important;
      color: white !important;
    }
    .validate-btn:hover {
      background: var(--primary-hover) !important;
      border-color: var(--primary-hover) !important;
    }
    .validate-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .yaml-key { color: #93c5fd; }
    .yaml-string { color: #86efac; }
    .yaml-number { color: #fdba74; }
    .yaml-comment { color: #9ca3af; font-style: italic; }
    .yaml-bool { color: #d8b4fe; }
    .chat-container {
      flex: 1;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      overflow-y: auto;
    }
    @media (max-width: 900px) {
      .chat-panel { max-width: 100%; }
    }
    .message {
      padding: 1rem;
      border-radius: 0.75rem;
      max-width: 85%;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .message.user {
      background: var(--primary);
      color: white;
      align-self: flex-end;
    }
    .message.assistant {
      background: var(--surface);
      border: 1px solid var(--border);
      align-self: flex-start;
    }
    .sources {
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
      font-size: 0.8125rem;
    }
    .sources-title {
      color: var(--text-muted);
      margin-bottom: 0.375rem;
    }
    .sources a {
      display: block;
      color: var(--primary);
      text-decoration: none;
      padding: 0.25rem 0;
    }
    .sources a:hover { text-decoration: underline; }
    /* Markdown in messages */
    .message p { margin: 0 0 0.5rem 0; }
    .message p:last-child { margin-bottom: 0; }
    .message a {
      color: var(--primary);
      text-decoration: none;
    }
    .message a:hover { text-decoration: underline; }
    .message code {
      background: rgba(0,0,0,0.1);
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.875em;
    }
    .message strong { font-weight: 600; }
    .md-list-item {
      padding-left: 0.5rem;
      margin: 0.25rem 0;
    }
    .md-bullet {
      color: var(--primary);
      margin-right: 0.25rem;
    }
    .input-container {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .input-wrapper {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      gap: 0.75rem;
    }
    input[type="text"] {
      flex: 1;
      padding: 0.75rem 1rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 1rem;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: var(--primary);
    }
    button {
      padding: 0.75rem 1.5rem;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: var(--primary-hover); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .loading {
      display: flex;
      gap: 0.25rem;
      padding: 0.5rem 0;
    }
    .loading span {
      width: 0.5rem;
      height: 0.5rem;
      background: var(--text-muted);
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .loading span:nth-child(1) { animation-delay: -0.32s; }
    .loading span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    .welcome {
      text-align: center;
      padding: 3rem 1.5rem;
      color: var(--text-muted);
    }
    .welcome h2 {
      color: var(--text);
      font-size: 1.5rem;
      margin-bottom: 0.75rem;
    }
    .welcome p {
      max-width: 400px;
      margin: 0 auto 1.5rem;
      line-height: 1.5;
    }
    .examples {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
    }
    .examples button {
      padding: 0.5rem 1rem;
      background: var(--surface);
      border: 1px solid var(--border);
      font-size: 0.875rem;
    }
    .examples button:hover {
      background: var(--surface-hover);
      border-color: var(--primary);
    }
    .loading-text {
      color: var(--text-muted);
      font-style: italic;
      font-size: 0.875rem;
    }
    .follow-ups {
      padding: 0.75rem 1.5rem;
      border-top: 1px solid var(--border);
      background: var(--surface);
    }
    .follow-ups-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-right: 0.5rem;
    }
    .follow-ups-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .follow-ups-chips button {
      padding: 0.375rem 0.75rem;
      font-size: 0.8125rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 1rem;
    }
    .follow-ups-chips button:hover {
      border-color: var(--primary);
      background: var(--surface-hover);
    }
    .follow-ups-chips button.contextual {
      border-color: var(--primary);
      background: rgba(167, 139, 250, 0.1);
    }
  </style>
</head>
<body>
  <header>
    <h1>Vulcan Docs Chat</h1>
    <a href="https://github.com/tmdc-io/vulcan-book" target="_blank">Documentation</a>
    <a href="https://github.com/tmdc-io/vulcan" target="_blank">Vulcan</a>
    <a href="/.well-known/mcp.json" target="_blank">MCP Config</a>
    <button id="newChatBtn" class="new-chat-btn" title="Start a new conversation">New Chat</button>
  </header>

  <div class="main-container">
    <div class="chat-panel">
      <div class="chat-container" id="chat">
        <div class="welcome" id="welcome">
          <h2>Ask about Vulcan</h2>
          <p>Chat with our documentation. I can help you with Vulcan concepts, usage, and more.</p>
        </div>
      </div>

      <div class="follow-ups" id="followUps" style="display: none;">
        <span class="follow-ups-label">Try next:</span>
        <div class="follow-ups-chips" id="followUpsChips"></div>
      </div>

      <div class="input-container">
        <form class="input-wrapper" onsubmit="sendMessage(event)">
          <input type="text" id="input" placeholder="Ask about Vulcan..." autocomplete="off">
          <button type="submit" id="send">Send</button>
        </form>
      </div>
    </div>
  </div>

  <script>
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    let history = [];
    let isLoading = false;


    // Parse markdown text and return a document fragment with safe DOM elements
    function parseMarkdown(text) {
      var fragment = document.createDocumentFragment();
      var lines = text.split('\\n');
      var currentParagraph = null;

      function flushParagraph() {
        if (currentParagraph && currentParagraph.childNodes.length > 0) {
          fragment.appendChild(currentParagraph);
          currentParagraph = null;
        }
      }

      function parseInline(str, container) {
        // Parse inline markdown: **bold**, [link](url), \`code\`
        var remaining = str;
        while (remaining.length > 0) {
          // Check for bold **text**
          var boldMatch = remaining.match(/^\\*\\*([^*]+)\\*\\*/);
          if (boldMatch) {
            var strong = document.createElement('strong');
            strong.textContent = boldMatch[1];
            container.appendChild(strong);
            remaining = remaining.slice(boldMatch[0].length);
            continue;
          }
          // Check for links [text](url)
          var linkMatch = remaining.match(/^\\[([^\\]]+)\\]\\(([^)]+)\\)/);
          if (linkMatch) {
            var a = document.createElement('a');
            a.href = linkMatch[2];
            a.textContent = linkMatch[1];
            a.target = '_blank';
            a.rel = 'noopener';
            container.appendChild(a);
            remaining = remaining.slice(linkMatch[0].length);
            continue;
          }
          // Check for inline code \`text\`
          var codeMatch = remaining.match(/^\`([^\`]+)\`/);
          if (codeMatch) {
            var code = document.createElement('code');
            code.textContent = codeMatch[1];
            container.appendChild(code);
            remaining = remaining.slice(codeMatch[0].length);
            continue;
          }
          // No match - add next character as text
          var idx1 = remaining.indexOf('*');
          var idx2 = remaining.indexOf('[');
          var idx3 = remaining.indexOf(String.fromCharCode(96));
          var nextSpecial = Math.min(
            idx1 === -1 ? remaining.length : idx1,
            idx2 === -1 ? remaining.length : idx2,
            idx3 === -1 ? remaining.length : idx3
          );
          if (nextSpecial === remaining.length) nextSpecial = -1;
          if (nextSpecial === -1) {
            container.appendChild(document.createTextNode(remaining));
            break;
          } else if (nextSpecial === 0) {
            container.appendChild(document.createTextNode(remaining[0]));
            remaining = remaining.slice(1);
          } else {
            container.appendChild(document.createTextNode(remaining.slice(0, nextSpecial)));
            remaining = remaining.slice(nextSpecial);
          }
        }
      }

      lines.forEach(function(line) {
        // Empty line - start new paragraph
        if (line.trim() === '') {
          flushParagraph();
          return;
        }

        // List item
        if (line.match(/^\\s*[-*]\\s+/)) {
          flushParagraph();
          var li = document.createElement('div');
          li.className = 'md-list-item';
          var bullet = document.createElement('span');
          bullet.className = 'md-bullet';
          bullet.textContent = '• ';
          li.appendChild(bullet);
          var content = line.replace(/^\\s*[-*]\\s+/, '').trim();
          parseInline(content, li);
          fragment.appendChild(li);
          return;
        }

        // Regular text - add to current paragraph
        if (!currentParagraph) {
          currentParagraph = document.createElement('p');
        } else {
          currentParagraph.appendChild(document.createElement('br'));
        }
        parseInline(line.trim(), currentParagraph);
      });

      flushParagraph();
      return fragment;
    }


    function addMessage(content, role, sources) {
      const welcome = document.getElementById('welcome');
      if (welcome) welcome.remove();

      const div = document.createElement('div');
      div.className = 'message ' + role;

      // Parse markdown for assistant messages, plain text for user
      if (role === 'assistant') {
        div.appendChild(parseMarkdown(content));
      } else {
        div.textContent = content;
      }

      if (role === 'assistant' && sources && sources.length > 0) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'sources';

        const title = document.createElement('div');
        title.className = 'sources-title';
        title.textContent = 'Sources:';
        sourcesDiv.appendChild(title);

        sources.forEach(function(s) {
          const link = document.createElement('a');
          link.href = s.url;
          link.target = '_blank';
          link.textContent = s.title;
          sourcesDiv.appendChild(link);
        });

        div.appendChild(sourcesDiv);
      }

      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function addLoading() {
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.id = 'loading';

      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'loading';
      for (let i = 0; i < 3; i++) {
        loadingDiv.appendChild(document.createElement('span'));
      }
      div.appendChild(loadingDiv);

      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function removeLoading() {
      const loading = document.getElementById('loading');
      if (loading) loading.remove();
    }

    async function sendMessage(e) {
      e.preventDefault();
      const message = input.value.trim();
      if (!message || isLoading) return;

      // Handle /new command
      if (message.toLowerCase() === '/new') {
        input.value = '';
        resetChat();
        return;
      }

      // Report false positive if validation passed but user is regenerating
      // NOTE: Disabled for Vulcan - validation reporting was Expanso-specific
      // if (lastValidationPassed && lastValidatedYaml) {
      //   fetch('https://validate.expanso.io/report', {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify({
      //       yaml: lastValidatedYaml,
      //       expected_error: 'User regenerated after validation passed',
      //       context: 'mcp'
      //     })
      //   }).catch(function(err) {
      //     console.error('Failed to report false positive:', err);
      //   });
      //   // Reset tracking flags
      //   lastValidationPassed = false;
      //   lastValidatedYaml = '';
      // }

      isLoading = true;
      sendBtn.disabled = true;
      input.value = '';

      addMessage(message, 'user');
      addLoading();

      try {
        const payload = { message: message, history: history };

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        removeLoading();

        if (data.error) {
          addMessage('Error: ' + data.error, 'assistant', []);
        } else {
          addMessage(data.response, 'assistant', data.sources || []);
          history.push({ role: 'user', content: message });
          history.push({ role: 'assistant', content: data.response });
        }
      } catch (err) {
        removeLoading();
        addMessage('Sorry, something went wrong. Please try again.', 'assistant', []);
      }

      isLoading = false;
      sendBtn.disabled = false;
      input.focus();
    }

    function askQuestion(q) {
      input.value = q;
      sendMessage({ preventDefault: function() {} });
    }


    // Reset chat function
    function resetChat() {
      // Clear history
      history = [];

      // Clear chat messages
      var chat = document.getElementById('chat');
      while (chat.firstChild) {
        chat.removeChild(chat.firstChild);
      }

      // Recreate welcome section
      var welcome = document.createElement('div');
      welcome.className = 'welcome';
      welcome.id = 'welcome';

      var h2 = document.createElement('h2');
      h2.textContent = 'Ask about Vulcan';
      welcome.appendChild(h2);

      var p = document.createElement('p');
      p.textContent = 'Chat with our documentation. I can help you with Vulcan concepts, usage, and more.';
      welcome.appendChild(p);

      chat.appendChild(welcome);

      input.focus();
    }

    // New Chat button handler
    document.getElementById('newChatBtn').onclick = resetChat;

    input.focus();
  </script>
</body>
</html>`;
}
