require('dotenv').config();
const { runPipeline } = require('../src/pipeline');

const query = process.argv.slice(2).join(' ');
if (!query) {
  console.error('Usage: npm run pipeline -- "cabinet de recrutement Paris"');
  process.exit(1);
}

runPipeline(query)
  .then(({ results, searchStats }) => {
    console.log(JSON.stringify({ results, searchStats }, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
