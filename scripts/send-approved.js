require('dotenv').config();
const { sendApproved } = require('../src/mailer');

sendApproved()
  .then((result) => console.log(result))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
