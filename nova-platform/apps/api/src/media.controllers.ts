import {Body,Controller,Delete,Get,Headers,HttpCode,Param,Post,Req,Res,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {IdentityGuard,OptionalIdentityGuard} from './auth.js';
import {MediaService} from './media.service.js';
import {ChatService} from './chat.service.js';
import {mediaAuthorizationInput} from './media-input.js';
const uuid=z.string().uuid();
const finite=z.number().finite().min(0).max(1e12);
const playerDiagnostic=z.object({stage:z.enum(['manifest','playing','waiting','error','snapshot']),readyState:z.number().int().min(0).max(4),networkState:z.number().int().min(0).max(3),paused:z.boolean(),time:finite,bufferEnd:finite,width:finite,height:finite,boxWidth:finite,boxHeight:finite,decodedFrames:finite,droppedFrames:finite,pixelAverage:z.number().finite().min(-1).max(255),detail:z.string().max(100).optional()}).strict();
@Controller()
export class MediaController {
  constructor(private readonly media:MediaService,private readonly chat:ChatService){}
  @Post('internal/media/authorize') @HttpCode(200) authorize(@Body() body:unknown){return this.media.authorize(mediaAuthorizationInput.parse(body));}
  @Get('internal/media/jobs') jobs(@Headers('authorization') authorization:string){this.media.internalAuth(authorization);return this.media.jobs();}
  @Get('internal/media/playback-access') async gatewayAccess(@Req() req:any,@Res() res:any){const access=await this.media.gatewayAccess(req);res.setHeader('Cache-Control','no-store');res.setHeader('X-Nova-Media-File',access.path);res.setHeader('X-Nova-Media-Mode',access.mode);res.status(200).end();}
  @Get('api/v1/me/channel/health') @UseGuards(IdentityGuard) async health(@Req() req:any){return this.media.health(await this.media.platform.actor(req.identity));}
  @Post('api/v1/play/:id/presence/heartbeat') @HttpCode(200) @UseGuards(OptionalIdentityGuard) heartbeat(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.media.viewerHeartbeat(uuid.parse(id),req,req.identity,z.object({leaseId:uuid,position:finite}).strict().parse(body));}
  @Post('api/v1/play/:id/presence/leave') @HttpCode(204) leave(@Req() req:any,@Param('id') id:string,@Body() body:unknown){this.media.audience.leave(req,uuid.parse(id),z.object({leaseId:uuid}).strict().parse(body).leaseId);}
  @Get('api/v1/channels/:id/thumbnail') @UseGuards(OptionalIdentityGuard) async thumbnail(@Req() req:any,@Res() res:any,@Param('id') id:string){res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');const image=await this.media.thumbnail(uuid.parse(id),req.identity);res.setHeader('Content-Type','image/jpeg');res.send(image);}
  @Post('api/v1/me/channel/browser-session') @HttpCode(200) @UseGuards(IdentityGuard) async browser(@Req() req:any,@Body() body:unknown){return this.media.browserOffer(await this.media.platform.actor(req.identity),z.object({offer:z.string().min(20).max(200000)}).strict().parse(body).offer);}
  @Post('api/v1/me/channel/stop') @HttpCode(200) @UseGuards(IdentityGuard) async stop(@Req() req:any){const user=await this.media.platform.actor(req.identity);return this.media.stop(user,user.channel?.id||'');}
  @Post('api/v1/me/channel/resume') @HttpCode(200) @UseGuards(IdentityGuard) async resume(@Req() req:any){const user=await this.media.platform.actor(req.identity);return this.media.resume(user,user.channel?.id||'');}
  @Post('api/v1/me/channel/stream-key/rotate') @HttpCode(200) @UseGuards(IdentityGuard) async rotate(@Req() req:any){return this.media.rotate(await this.media.platform.actor(req.identity),req.identity);}
  @Get('api/v1/admin/streams') @UseGuards(IdentityGuard) async streams(@Req() req:any){return this.media.sessions(await this.media.platform.actor(req.identity));}
  @Post('api/v1/admin/channels/:id/stop') @HttpCode(200) @UseGuards(IdentityGuard) async adminStop(@Req() req:any,@Param('id') id:string){return this.media.stop(await this.media.platform.actor(req.identity),uuid.parse(id),true);}
  @Post('api/v1/admin/channels/:id/resume') @HttpCode(200) @UseGuards(IdentityGuard) async adminResume(@Req() req:any,@Param('id') id:string){return this.media.resume(await this.media.platform.actor(req.identity),uuid.parse(id),true);}
  @Post('api/v1/channels/:id/playback') @HttpCode(200) @UseGuards(OptionalIdentityGuard) async ticket(@Req() req:any,@Res({passthrough:true}) res:any,@Param('id') id:string){const channelId=uuid.parse(id),token=await this.media.playbackTicket(channelId,req.identity);res.setHeader('Cache-Control','no-store');this.media.audience.ensureBrowser(req,res);res.cookie('nova_play',token,{httpOnly:true,secure:true,sameSite:'strict',maxAge:300000,path:`/api/v1/play/${channelId}`});return {url:`/api/v1/play/${channelId}/index.m3u8`,expiresIn:300};}
  @Get('api/v1/play/:id/:file') play(@Req() req:any,@Res() res:any,@Param('id') id:string,@Param('file') file:string){return this.media.playback(uuid.parse(id),file,req,res);}
  @Post('api/v1/play/:id/diagnostics') @HttpCode(200) diagnostic(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.media.playbackDiagnostic(uuid.parse(id),req,playerDiagnostic.parse(body));}
  @Get('api/v1/channels/:id/chat') @UseGuards(IdentityGuard) history(@Req() req:any,@Param('id') id:string){return this.chat.history(req.identity,uuid.parse(id));}
  @Get('api/v1/channels/:id/chat/events') @UseGuards(IdentityGuard) events(@Req() req:any,@Res() res:any,@Param('id') id:string){return this.chat.stream(req.identity,uuid.parse(id),res);}
  @Post('api/v1/channels/:id/chat') @HttpCode(200) @UseGuards(IdentityGuard) send(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.chat.send(req.identity,uuid.parse(id),z.object({text:z.string().trim().min(1).max(500),clientMessageId:uuid,epoch:z.number().int().nonnegative().optional()}).strict().parse(body));}
  @Delete('api/v1/channels/:id/chat/:message') @UseGuards(IdentityGuard) remove(@Req() req:any,@Param('id') id:string,@Param('message') message:string){return this.chat.remove(req.identity,uuid.parse(id),z.coerce.number().int().positive().parse(message));}
}
