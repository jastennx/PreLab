require('dotenv').config();
const app = require('./src/app');
const config = require('./src/config');

app.listen(config.port, () => {
  console.log(`PreLab running at http://localhost:${config.port}`);
});
