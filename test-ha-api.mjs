import axios from 'axios';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const db = new Database('/app/data/app.db');
const config = db.prepare('SELECT ha_url, ha_token, encryption_key FROM config WHERE id = 1').get();

// Decrypt token
const [iv, encrypted] = config.ha_token.split(':');
const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(config.encryption_key, 'hex'), Buffer.from(iv, 'hex'));
let token = decipher.update(encrypted, 'hex', 'utf8');
token += decipher.final('utf8');

console.log('Testing HA API access...\n');

const client = axios.create({
  baseURL: config.ha_url,
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

// Test 1: Get all states
console.log('1. Fetching all states...');
try {
  const res = await client.get('/api/states');
  const todoStates = res.data.filter(s => s.entity_id.startsWith('todo.'));
  console.log(`   Found ${todoStates.length} todo entities`);
  todoStates.forEach(state => {
    console.log(`   - ${state.entity_id}: ${state.state}`);
    console.log(`     Attributes:`, Object.keys(state.attributes || {}));
    if (state.attributes?.items) {
      console.log(`     Items count: ${state.attributes.items.length}`);
    }
  });
} catch (error) {
  console.error('   Error:', error.response?.status, error.message);
}

// Test 2: Try service call
console.log('\n2. Testing service call /api/services/todo/get_items...');
try {
  const res = await client.post('/api/services/todo/get_items', {
    entity_id: 'todo.einkaufsliste'
  });
  console.log('   Service response:', res.data);
} catch (error) {
  console.error('   Error:', error.response?.status, error.response?.data || error.message);
}

// Test 3: Direct entity access
console.log('\n3. Testing direct entity query...');
try {
  const res = await client.get('/api/states/todo.einkaufsliste');
  console.log('   Entity state:', res.data.state);
  console.log('   Attributes:', Object.keys(res.data.attributes || {}));
  console.log('   Full response:');
  console.log(JSON.stringify(res.data, null, 2));
} catch (error) {
  console.error('   Error:', error.response?.status, error.message);
}

db.close();
