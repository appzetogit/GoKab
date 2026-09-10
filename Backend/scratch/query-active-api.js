import http from 'http';

http.get('http://localhost:5000/api/v1/advertisements/active', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response Headers:', res.headers);
    console.log('Response Body:', data);
  });
}).on('error', (err) => {
  console.error('Error querying active ads API:', err);
});
