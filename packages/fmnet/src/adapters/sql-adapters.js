

class BaseSQLAdapter {
  constructor(openDb, closeDb) {
    this.openDb = openDb || async function () { };
    this.closeDb = closeDb || async function () { };
  }
  _snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  toObject(sqlData) {
    const obj = {}
    for (const f in sqlData) {
      obj[this._snakeToCamel(f)] = sqlData[f];
    }

    return obj;
  }
}



export class BetterSqliteAdapter extends BaseSQLAdapter {
  async read(sql, params) {
    const db = await this.openDb();

    try {
      if (params) {
        const rows = await db.prepare(sql).all(...params)
        return rows.map(r => this.toObject(r))
      }
      const rows = await db.prepare(sql).all()
      return rows.map(r => this.toObject(r))
    } catch (e) {
      throw e;
    } finally {
      this.closeDb(db);
    }
  }

  async readOne(sql, params) {
    const db = await this.openDb();
    
    try {
      let row
      if(params){
        row = await db.prepare(sql).get(...params)
      } else {
        row = await db.prepare(sql).get()
      }
      if (!row) {
        return null;
      }
      return this.toObject(row);
    } catch (e) {
      throw e;
    } finally {
      this.closeDb(db);
    }
  }

  async write(sql, params) {
    const db = await this.openDb();
    try {
      const s = db.prepare(sql)
      if (params) {
        s.bind(...params)
      }
      return s.run()
    } catch (e) {
      throw e;
    } finally {
      this.closeDb(db);
    }
  }
}


export class ExpoSqliteAdapter extends BaseSQLAdapter {
  
  async read(sql, params = []) {
    const db = await this.openDb();
    const rows = await db.getAllAsync(sql, params);
    return rows.map(r => this.toObject(r));
  }

  async readOne(sql, params = []) {
    const db = await this.openDb();
    const row = await db.getFirstAsync(sql, params);
    return row ? this.toObject(row) : null;
  }

  async write(sql, params = []) {
    const db = await this.openDb();
    return db.runAsync(sql, params);
  }
}