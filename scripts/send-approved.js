require('dotenv').config();
const { sendQualifiedLeads } = require('../src/mailer');

sendQualifiedLeads()
  .then((result) => console.log(result))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
