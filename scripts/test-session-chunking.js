const assert = require('node:assert/strict');
const Module = require('node:module');

const docs = [];
const makeCollection = () => ({
  async find(query) { return docs.filter(d => d.number === query.number).map(d => ({ ...d })); },
  async deleteMany(query) {
    for (let i = docs.length - 1; i >= 0; i--) if (docs[i].number === query.number) docs.splice(i, 1);
  },
  async create(data) { docs.push({ _id: String(docs.length), ...data }); return data; },
  async findOne() { return null; },
  async findOneAndUpdate() { return null; },
  async deleteOne() { return { deletedCount: 0 }; },
  async updateMany() { return { modifiedCount: 0 }; },
  async countDocuments() { return 0; }
});

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './mongo' && parent && parent.filename.endsWith('/lib/database.js')) {
    return { isMongoConfigured: false, ensureConnected: async () => {}, model: () => makeCollection() };
  }
  return originalLoad.apply(this, arguments);
};
const { saveFullSessionFolderToMongoDB, getFullSessionFolderFromMongoDB } = require('../lib/database');
Module._load = originalLoad;

(async () => {
  const content = 'x'.repeat(17 * 1024 * 1024) + 'শেষ';
  const input = { 'session-big.json': content, 'small.json': '{"ok":true}' };
  assert.equal(await saveFullSessionFolderToMongoDB('923000000000', input), true);
  assert.ok(docs.length >= 18, 'large session should be split into multiple records');
  assert.ok(docs.every(doc => Buffer.byteLength(doc.content || '', 'utf8') < 2 * 1024 * 1024), 'each stored record must remain bounded');
  const restored = await getFullSessionFolderFromMongoDB('923000000000');
  assert.deepEqual(restored, input);
  console.log('session chunking regression: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });

