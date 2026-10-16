import { hashPassword } from '../src/auth.js';
import { database,sql,closeDatabase } from '../src/db.js';
const username=process.argv[2];
try {
  const password=process.env.TPLUS_INITIAL_PASSWORD;
  if (!username || username.length>50 || !password || password.length<12 || password.length>200) throw new Error('Usage: set TPLUS_INITIAL_PASSWORD (12-200 characters), then npm run user:create -- operator');
  const {salt,hash}=await hashPassword(password);
  await (await database()).request().input('name',sql.VarChar(50),username).input('hash',sql.VarChar(255),hash).input('salt',sql.VarChar(255),salt).query('INSERT INTO dbo.Users (Username,DisplayName,PasswordHash,PasswordSalt) VALUES (@name,@name,@hash,@salt)');
  console.log('Operator created.');
} catch(error) { console.error('Could not create operator:',error.code || error.message);process.exitCode=1; }
finally { await closeDatabase(); }
