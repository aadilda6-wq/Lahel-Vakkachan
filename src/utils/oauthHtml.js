/**
 * Generates the success HTML page with a premium dark theme, glassmorphism, and copy functionality.
 * @param {string} refreshToken The obtained refresh token
 * @returns {string} The HTML string
 */
function getSuccessHtml(refreshToken) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Calendar Authorization - Success</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #0f0c20 0%, #15102a 50%, #06040a 100%);
      --card-bg: rgba(255, 255, 255, 0.03);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary-color: #9900ff;
      --secondary-color: #00ffbb;
      --text-main: #f3f1f6;
      --text-muted: #a5a1b8;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Outfit', sans-serif;
      background: var(--bg-gradient);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow-x: hidden;
    }
    .container {
      width: 100%;
      max-width: 600px;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 40px;
      backdrop-filter: blur(20px);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
      position: relative;
      overflow: hidden;
      animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .card::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(153, 0, 255, 0.1) 0%, transparent 60%);
      z-index: -1;
      pointer-events: none;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      margin-top: 0;
      margin-bottom: 10px;
      background: linear-gradient(90deg, #b066ff, #00ffbb);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }
    p {
      color: var(--text-muted);
      line-height: 1.6;
      font-size: 1.05rem;
      margin-bottom: 30px;
    }
    .token-box {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 18px 80px 18px 20px;
      font-family: monospace;
      font-size: 0.95rem;
      word-break: break-all;
      margin-bottom: 25px;
      position: relative;
      color: #00ffbb;
      box-shadow: inset 0 2px 8px rgba(0,0,0,0.3);
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .token-box:hover {
      border-color: rgba(0, 255, 187, 0.4);
      background: rgba(0, 0, 0, 0.35);
    }
    .copy-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: var(--primary-color);
      border: none;
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.8rem;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(153, 0, 255, 0.3);
    }
    .copy-btn:hover {
      background: #aa22ff;
      transform: translateY(-50%) scale(1.05);
    }
    .copy-btn:active {
      transform: translateY(-50%) scale(0.95);
    }
    .instructions {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 25px;
      margin-top: 25px;
    }
    .instructions h2 {
      font-size: 1.2rem;
      margin-bottom: 15px;
      color: var(--text-main);
    }
    .instructions ol {
      padding-left: 20px;
      color: var(--text-muted);
      line-height: 1.8;
      font-size: 0.95rem;
    }
    .instructions code {
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      color: #b066ff;
    }
    .badge {
      display: inline-block;
      background: rgba(0, 255, 187, 0.1);
      color: var(--secondary-color);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 15px;
      text-transform: uppercase;
      letter-spacing: 1px;
      border: 1px solid rgba(0, 255, 187, 0.2);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="badge">Success</div>
      <h1>Authorization successful.</h1>
      <p>The bot has successfully authenticated with Google. Below is your <strong>Refresh Token</strong>:</p>
      
      <div class="token-box" onclick="copyToken()">
        <span id="tokenText">${refreshToken}</span>
        <button class="copy-btn" id="copyBtn">Copy</button>
      </div>

      <div class="instructions">
        <h2>Next Steps</h2>
        <ol>
          <li>Copy the token above.</li>
          <li>Open your bot's <code>.env</code> file in the project root directory.</li>
          <li>Save the token as: <code>GOOGLE_REFRESH_TOKEN=your_copied_token</code>.</li>
          <li>Restart the Discord bot to apply the changes.</li>
        </ol>
      </div>
    </div>
  </div>

  <script>
    function copyToken() {
      const token = document.getElementById('tokenText').innerText;
      navigator.clipboard.writeText(token).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.innerText = 'Copied!';
        btn.style.background = '#00ffbb';
        btn.style.color = '#0b0816';
        setTimeout(() => {
          btn.innerText = 'Copy';
          btn.style.background = '#9900ff';
          btn.style.color = '#ffffff';
        }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Generates the error HTML page with a premium dark red theme.
 * @param {string} errorMessage The failure message
 * @returns {string} The HTML string
 */
function getErrorHtml(errorMessage) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Failed</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #1f0c0c 0%, #2a1010 50%, #0a0404 100%);
      --card-bg: rgba(255, 255, 255, 0.03);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary-color: #ff3333;
      --text-main: #f6f1f1;
      --text-muted: #b8a1a1;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Outfit', sans-serif;
      background: var(--bg-gradient);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .container {
      width: 100%;
      max-width: 600px;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 40px;
      backdrop-filter: blur(20px);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
      text-align: center;
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      margin-top: 0;
      margin-bottom: 10px;
      background: linear-gradient(90deg, #ff6666, #ff3333);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--text-muted);
      line-height: 1.6;
      font-size: 1.05rem;
      margin-bottom: 30px;
    }
    .btn {
      display: inline-block;
      background: var(--primary-color);
      color: white;
      text-decoration: none;
      padding: 12px 30px;
      border-radius: 12px;
      font-weight: 600;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(255, 51, 51, 0.3);
    }
    .btn:hover {
      background: #ff5555;
      transform: scale(1.05);
    }
    .badge {
      display: inline-block;
      background: rgba(255, 51, 51, 0.1);
      color: var(--primary-color);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 15px;
      text-transform: uppercase;
      letter-spacing: 1px;
      border: 1px solid rgba(255, 51, 51, 0.2);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="badge">Error</div>
      <h1>Authorization Failed</h1>
      <p>Something went wrong during the Google authorization process: <br><strong style="color: #ff6666;">${errorMessage}</strong></p>
      <a href="/auth/google" class="btn">Try Again</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  getSuccessHtml,
  getErrorHtml
};
