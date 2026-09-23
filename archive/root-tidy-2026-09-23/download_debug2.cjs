const https = require('https');
const fs = require('fs');
https.get('https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev/debug/golden_e9e239c5_1788736355142.json', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    fs.writeFileSync('debug2.json', data);
    console.log('Downloaded debug2.json');
  });
});
