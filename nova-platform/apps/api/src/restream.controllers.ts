import {Body,Controller,Delete,Get,Header,Headers,HttpCode,Param,Patch,Post,Query,Req,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {IdentityGuard} from './auth.js';
import {RestreamService} from './restream.service.js';
import {RESTREAM_ERRORS,RESTREAM_PROVIDERS} from './restream-policy.js';
const uuid=z.string().uuid(),fields={provider:z.enum(RESTREAM_PROVIDERS),name:z.string().trim().min(1).max(60),serverUrl:z.string().trim().min(1).max(500),streamKey:z.string().min(1).max(2048),enabled:z.boolean(),maxHeight:z.union([z.literal(720),z.literal(1080)])};
const create=z.object({...fields,enabled:fields.enabled.default(false),maxHeight:fields.maxHeight.default(720)}).strict();
const update=z.object({provider:fields.provider.optional(),name:fields.name.optional(),serverUrl:fields.serverUrl.optional(),streamKey:fields.streamKey.optional(),enabled:fields.enabled.optional(),maxHeight:fields.maxHeight.optional(),version:z.number().int().positive()}).strict().refine(v=>Object.keys(v).length>1);
@Controller()
export class RestreamController {
 constructor(readonly service:RestreamService){}
 @Get('api/v1/admin/restreams') @UseGuards(IdentityGuard) async adminChannels(@Req() req:any){const user=await this.service.platform.actor(req.identity);this.service.platform.require(user,'restreams.manage_any');return this.service.platform.db.channel.findMany({orderBy:{createdAt:'desc'},take:200,select:{id:true,title:true,slug:true,state:true,_count:{select:{restreamDestinations:true}}}});}
 @Get('api/v1/me/channel/restreams') @UseGuards(IdentityGuard) async list(@Req() req:any){return this.service.list(await this.service.platform.actor(req.identity));}
 @Post('api/v1/me/channel/restreams') @HttpCode(200) @UseGuards(IdentityGuard) async create(@Req() req:any,@Body() body:unknown){return this.service.save(await this.service.platform.actor(req.identity),undefined,create.parse(body));}
 @Patch('api/v1/me/channel/restreams/:id') @UseGuards(IdentityGuard) async edit(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.save(await this.service.platform.actor(req.identity),uuid.parse(id),update.parse(body));}
 @Delete('api/v1/me/channel/restreams/:id') @UseGuards(IdentityGuard) async remove(@Req() req:any,@Param('id') id:string,@Query('version') version:string){return this.service.remove(await this.service.platform.actor(req.identity),uuid.parse(id),z.coerce.number().int().positive().parse(version));}
 @Get('api/v1/admin/channels/:channel/restreams') @UseGuards(IdentityGuard) async adminList(@Req() req:any,@Param('channel') channel:string){return this.service.list(await this.service.platform.actor(req.identity),uuid.parse(channel));}
 @Post('api/v1/admin/channels/:channel/restreams') @HttpCode(200) @UseGuards(IdentityGuard) async adminCreate(@Req() req:any,@Param('channel') channel:string,@Body() body:unknown){return this.service.save(await this.service.platform.actor(req.identity),undefined,create.parse(body),uuid.parse(channel));}
 @Patch('api/v1/admin/channels/:channel/restreams/:id') @UseGuards(IdentityGuard) async adminEdit(@Req() req:any,@Param('channel') channel:string,@Param('id') id:string,@Body() body:unknown){return this.service.save(await this.service.platform.actor(req.identity),uuid.parse(id),update.parse(body),uuid.parse(channel));}
 @Delete('api/v1/admin/channels/:channel/restreams/:id') @UseGuards(IdentityGuard) async adminRemove(@Req() req:any,@Param('channel') channel:string,@Param('id') id:string,@Query('version') version:string){return this.service.remove(await this.service.platform.actor(req.identity),uuid.parse(id),z.coerce.number().int().positive().parse(version),uuid.parse(channel));}
 @Get('internal/restream/jobs') @Header('Cache-Control','no-store') jobs(@Headers('authorization') authorization:string){this.service.internalAuth(authorization);return this.service.jobs();}
 @Post('internal/restream/:id/status') @HttpCode(200) report(@Headers('authorization') authorization:string,@Param('id') id:string,@Body() body:unknown){this.service.internalAuth(authorization);return this.service.report(uuid.parse(id),z.object({version:z.number().int().positive(),sessionId:uuid,status:z.enum(['starting','sending','reconnecting','error','queued']),errorCode:z.enum(RESTREAM_ERRORS).nullable().optional(),bitrateKbps:z.number().finite().min(0).max(1000000),bytesSent:z.number().finite().min(0).max(1e15)}).strict().parse(body));}
}
