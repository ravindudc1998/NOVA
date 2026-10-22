import {Injectable,OnModuleDestroy} from '@nestjs/common';
import {Prisma,PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {Pool} from 'pg';
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  private readonly pool:Pool;
  constructor(){const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000});super({adapter:new PrismaPg(pool,{disposeExternalPool:true})});this.pool=pool;pool.on('error',()=>console.error('Database connection unavailable.'));}
  // The measured media hot path uses the same bounded pool without ORM result conversion.
  async mediaQuery(query:Prisma.Sql){return (await this.pool.query(query.text,query.values)).rows;}
  async $disconnect(){await super.$disconnect();if(!this.pool.ending)await this.pool.end();}
  async onModuleDestroy(){await this.$disconnect();}
}
