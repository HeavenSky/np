const Nested = require('./nested');

class Context {
  constructor() {
    this.nested = new Nested([]);
    // linkDir => version, 同一次运行内已提升到根目录的版本
    this.hoistedVersions = new Map();
    this.workspaceRootDepNames = null;
  }
}

module.exports = Context;
