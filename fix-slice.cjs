const fs = require('fs');
const file = 'src/components/chat-cards/FoodCard.tsx';
let content = fs.readFileSync(file, 'utf8');

// Fix data.images.slice to (data.images || []).slice
content = content.replace(/data\.images\.slice/g, '(data.images || []).slice');
fs.writeFileSync(file, content);
