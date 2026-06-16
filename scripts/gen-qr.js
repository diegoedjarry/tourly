const qr = require('../node_modules/qrcode');
const fs = require('fs');
const url = 'exp://9rla1i8-anonymous-8082.exp.direct';

qr.toDataURL(url, { width: 300, margin: 2 }, (err, dataUrl) => {
  if (err) { console.error(err); return; }
  const html = `<!DOCTYPE html>
<html>
<body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#fff;margin:0">
  <h2 style="color:#5B5BD6;margin-bottom:24px">Scan with Expo Go</h2>
  <img src="${dataUrl}" width="300" height="300"/>
  <p style="color:#999;margin-top:16px;font-size:13px">${url}</p>
</body>
</html>`;
  fs.writeFileSync('tourly-qr.html', html);
  console.log('Done: tourly-qr.html');
});
