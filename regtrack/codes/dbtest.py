"""Direct native PostgreSQL assertions for business tests."""
import db
from psycopg import sql
STAMP={'created_at':'2026-01-01 00:00:00','updated_at':'2026-01-01 00:00:00'}
class Database:
    def __init__(self,dsn): self.conn=db.connect(dsn,autocommit=True)
    def __enter__(self): return self
    def __exit__(self,*exc): self.conn.close()
    def execute(self,statement,params=()): return self.conn.execute(statement,tuple(params))
    def scalar(self,statement,params=()): return self.execute(statement,params).fetchone()[0]
    def rows(self,statement,params=()): return db._rows(self.execute(statement,params))
    def insert(self,table,data):
        statement=sql.SQL('INSERT INTO {} ({}) VALUES ({}) RETURNING id').format(sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,data)),sql.SQL(',').join(sql.Placeholder() for _ in data))
        if table in {"standard_impact_area","meeting_standard"}:
            self.execute(statement.as_string().removesuffix(" RETURNING id"),list(data.values()));return None
        return self.execute(statement,list(data.values())).fetchone()[0]
    def columns(self,table): return [c.name for c in self.execute(sql.SQL('SELECT * FROM {} WHERE false').format(sql.Identifier(table))).description]
    def close(self): self.conn.close()
