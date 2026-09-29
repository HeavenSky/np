const path = require('node:path');

const reactDom = path.dirname(require.resolve('react-dom/package.json'));
console.log('reactDom %s', reactDom);

const react = require.resolve('react/package.json', { paths: [ reactDom ] });
console.log('react %s', react);

module.exports = 'packages/a';
