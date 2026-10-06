'use strict';

const fs = require('fs');
const assert = require('assert');
const mm = require('mm');
const path = require('path');
const mockNprc = path.join(__dirname, '../fixtures/auth/');
if (!fs.existsSync(mockNprc + '.nprc')) {
  fs.writeFileSync(
    mockNprc + '.nprc',
    'registry=https://registry-mock.org/\n//registry-mock.org/:always-auth=true\n//registry-mock.org/:_password="bW9jaw=="\n//registry-mock.org/:username=hyj19911120'
  );
}
mm(process.env, 'HOME', mockNprc);
mm(process.env, 'USERPROFILE', mockNprc);
// clean np_config.js cache
delete require.cache[require.resolve('../../lib/get')];
delete require.cache[require.resolve('../../lib/np_config')];
const get = require('../../lib/get');
mm.restore();

describe('test/registry/get.test.js', () => {
  it('should set auth info into header', async () => {
    const logger = {
      warn(msg) {
        assert(msg.includes('[npd:get] retry GET'));
      },
    };
    const options = { dataType: 'json' };
    assert(fs.existsSync(mockNprc + '.nprc'));
    try {
      await get('https://registry-mock.org/mock', options, { console: logger });
      assert(false, 'should not run this');
    } catch (err) {
      console.error(err);
      const headers = options.headers;
      assert(headers.Authorization);
      assert(err.message.includes('ENOTFOUND') || err.message.includes('Connect Timeout Error'));
      assert(err.res.requestUrls.length > 0);
    }
  });

  for (const url of ['https://other-mock.org/mock', 'https://other-mock.org/mock?from=//registry-mock.org/']) {
    it(`should not send auth info to other host even with always-auth: ${url}`, async () => {
      const options = { dataType: 'json', retry: 0 };
      await assert.rejects(get(url, options, { console: { warn() {} } }));
      assert.equal(options.headers.Authorization, undefined);
    });
  }

  // 依赖 urllib 3 内置的 undici(>= 5.28)在跨源重定向时去掉认证头; 降级 urllib 或改为自行跟随重定向时必须保持这一行为
  for (const streaming of [false, true]) {
    it(`should drop Authorization on cross-origin redirect, streaming: ${streaming}`, async () => {
      const http = require('node:http');
      const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      let receivedAuth = 'not requested';
      const target = http.createServer((req, res) => {
        receivedAuth = req.headers.authorization;
        res.end('ok');
      });
      await listen(target);
      const origin = http.createServer((req, res) => {
        res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/tarball` });
        res.end();
      });
      await listen(origin);
      try {
        const result = await get(
          `http://127.0.0.1:${origin.address().port}/manifest`,
          { headers: { Authorization: 'Bearer secret' }, followRedirect: true, streaming, retry: 0 },
          { console: { warn() {} } }
        );
        if (streaming) {
          for await (const _ of result.res);
        }
        assert.equal(result.status, 200);
        assert.equal(receivedAuth, undefined);
      } finally {
        origin.close();
        target.close();
      }
    });
  }
});
