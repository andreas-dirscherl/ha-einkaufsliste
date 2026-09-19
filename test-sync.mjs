import axios from 'axios';

async function testSync() {
  try {
    // Login
    const loginRes = await axios.post('http://localhost:3000/api/login', {
      username: 'testuser',
      password: 'testpass123'
    });
    
    const token = loginRes.data.token;
    console.log('✓ Logged in');
    
    // Trigger sync
    console.log('\nTriggering sync...');
    const syncRes = await axios.post(
      'http://localhost:3000/api/admin/sync/lists',
      {},
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    console.log('Sync response:', syncRes.data);
    
    // Wait and check items
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get lists
    const listsRes = await axios.get(
      'http://localhost:3000/api/lists',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    console.log('\nLists after sync:');
    listsRes.data.forEach(list => {
      console.log(`  - ${list.name}: ${list.item_count || 0} items`);
    });
    
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}

testSync();
