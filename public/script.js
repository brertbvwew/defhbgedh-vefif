// public/script.js
document.getElementById('checkBtn').addEventListener('click', async () => {
  const encoded = document.getElementById('encoded').value.trim();
  const amount = parseInt(document.getElementById('amount').value, 10);

  const out = document.getElementById('output');
  out.style.display = 'block';
  out.innerHTML = 'Checking...';

  try {
    const resp = await fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encodedMessage: encoded, targetAmount: amount })
    });

    const data = await resp.json();

    if (resp.status === 200 && data.ok) {
      out.innerHTML = `<strong>Verified ✔</strong><br>Amount: ${data.amount}<br>
        Coupon (copyable): <div class="coupon" id="coupon">${data.coupon}</div>
        <br><button id="copyBtn">Copy coupon</button>
        <div style="margin-top:8px;color:#666">${data.note || ''}</div>
      `;
      document.getElementById('copyBtn').addEventListener('click', () => {
        const el = document.getElementById('coupon');
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        alert('Coupon copied to clipboard');
      });
    } else if (resp.status === 400) {
      out.innerHTML = `<strong>Verification failed</strong><br>Reason: ${data.reason || JSON.stringify(data)}`;
    } else if (resp.status === 500) {
      // server returned fallback coupon
      out.innerHTML = `<strong>Server error (500)</strong><br>Reason: ${data.reason || data.error || 'internal error'}<br><br>
        Coupon (copyable): <div class="coupon" id="coupon">${data.coupon}</div>
        <br><button id="copyBtn">Copy coupon</button>
        <div style="margin-top:8px;color:#666">${data.note || ''}</div>
      `;
      document.getElementById('copyBtn').addEventListener('click', () => {
        const el = document.getElementById('coupon');
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        alert('Coupon copied to clipboard');
      });
    } else {
      out.innerHTML = `Unexpected response: ${resp.status} ${JSON.stringify(data)}`;
    }
  } catch (err) {
    out.innerHTML = `Network or internal error: ${String(err)}`;
  }
});
