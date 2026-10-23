import {Body,Catch,Controller,ExceptionFilter,ArgumentsHost,Get,Headers,HttpCode,HttpException,Module,Param,Patch,Post,Query,Req,Res,UseGuards,ForbiddenException} from '@nestjs/common';
import {z} from 'zod';
import {PlatformService} from './platform.service.js';
import {IdentityGuard,OptionalIdentityGuard} from './auth.js';
import {Database} from './database.js';
import {MediaController} from './media.controllers.js';
import {RestreamController} from './restream.controllers.js';
import {RestreamService} from './restream.service.js';
import {MediaService} from './media.service.js';
import {ChatService} from './chat.service.js';
import {LibraryService} from './library.service.js';
import {LibraryController} from './library.controllers.js';
import {AudienceService} from './audience.service.js';
import {CommunityController} from './community.controllers.js';
import {CategoryService} from './category.service.js';
import {BrandingService} from './branding.service.js';
import {SocialController} from './social.controllers.js';
import {SocialService} from './social.service.js';
import {AccountService} from './account.service.js';
import {AnalyticsService} from './analytics.service.js';
import {IdentityAdminService} from './identity-admin.service.js';
const uuid=z.string().uuid();
const clientErrorInput=z.object({reference:z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),kind:z.enum(['react','runtime','promise','startup','navigation']),route:z.enum(['home','discover','studio','admin','channel','other']),message:z.string().max(1000),stack:z.string().max(3000),componentStack:z.string().max(2000)}).strict();
const groupInput=z.object({name:z.string().trim().min(2).max(60),description:z.string().trim().max(300).default(''),permissions:z.array(z.string().max(80)).max(100)}).strict();
const settingInput=z.object({expectedVersion:z.number().int().min(1),registrationEnabled:z.boolean().optional(),creatorSignupEnabled:z.boolean().optional(),creatorApprovalRequired:z.boolean().optional(),liveNotificationsEnabled:z.boolean().optional(),publishingEnabled:z.boolean().optional(),browserPublishingEnabled:z.boolean().optional(),restreamingEnabled:z.boolean().optional(),restreamMaxDestinations:z.number().int().min(1).max(8).optional(),restreamMaxActive:z.number().int().min(1).max(64).optional(),guestViewingEnabled:z.boolean().optional(),chatEnabled:z.boolean().optional(),recordingAllowed:z.boolean().optional(),defaultLanguage:z.enum(['en','si','ta']).optional(),defaultCategory:z.string().trim().min(1).max(50).optional(),defaultSlowModeSeconds:z.number().int().min(0).max(120).optional(),platformName:z.string().trim().min(1).max(40).optional(),announcement:z.string().max(500).optional(),maintenanceEnabled:z.boolean().optional()}).strict();
@Controller()
export class PublicController {
  constructor(private readonly service:PlatformService,private readonly library:LibraryService){}
  private clientErrorWindow=0;private clientErrorCount=0;
  @Post('api/v1/client-errors') @HttpCode(204) clientError(@Body() body:unknown,@Req() req:any){
    const report=clientErrorInput.parse(body),now=Date.now();if(now-this.clientErrorWindow>60000){this.clientErrorWindow=now;this.clientErrorCount=0;}
    if(++this.clientErrorCount<=30){const agent=String(req.headers['user-agent']||''),browser=agent.includes('Edg/')?'Edge':agent.includes('Chrome/')?'Chrome':'Other';console.info(JSON.stringify({event:report.kind==='navigation'?'client.navigation':'client.error',browser,...report}));}
  }
  @Get('health/live') live(){return {status:'ok',service:'nova-api',stage:'live-development'};}
  @Get('health/ready') async ready(){await this.service.db.$queryRaw`SELECT 1`;return {status:'ready'};}
  @Get('api/v1/config') async config(){const s=await this.service.settings();return {name:s.platformName,announcement:s.announcement,registrationEnabled:s.registrationEnabled,creatorSignupEnabled:s.creatorSignupEnabled,identity:{url:process.env.PUBLIC_IDENTITY_URL,realm:'nova',clientId:'nova-web'},stage:'live-development'};}
  @Get('api/v1/channels') channels(@Query('live') live?:string,@Query('category') category?:string){if(live!==undefined)z.enum(['true','false']).parse(live);return this.library.channels(live==='true',category?uuid.parse(category):undefined);}
  @Get('api/v1/channels/:id') channel(@Param('id') id:string){return this.library.channel(uuid.parse(id));}
  @Post('api/v1/channels/lookup') @HttpCode(200) lookup(@Body() body:unknown){return this.library.lookup(z.object({ids:z.array(uuid).max(50)}).strict().parse(body).ids);}
}
@Controller('api/v1/me') @UseGuards(IdentityGuard)
export class AccountController {
  constructor(private readonly service:PlatformService){}
  @Post('bootstrap') @HttpCode(200) bootstrap(@Req() req:any,@Body() body:unknown){return this.service.bootstrap(req.identity,z.object({accountType:z.enum(['viewer','creator']),slug:z.string().optional()}).strict().parse(body));}
  @Get() async me(@Req() req:any){return this.service.present(await this.service.actor(req.identity));}
  @Get('channel') async studio(@Req() req:any){return this.service.studio(await this.service.actor(req.identity));}
  @Patch('channel') async update(@Req() req:any,@Body() body:unknown){const input=z.object({version:z.number().int().min(1),title:z.string().trim().min(1).max(100),bio:z.string().max(500),settings:z.object({language:z.enum(['en','si','ta']).optional(),category:z.string().min(1).max(50).optional(),chatEnabled:z.boolean().optional(),slowModeSeconds:z.number().int().min(0).max(120).optional()}).strict()}).strict().parse(body);return this.service.updateStudio(await this.service.actor(req.identity),input);}
  @Post('channel/stream-key/reveal') @HttpCode(200) async reveal(@Req() req:any,@Res({passthrough:true}) res:any){res.setHeader('Cache-Control','no-store');return this.service.revealKey(await this.service.actor(req.identity),req.identity);}
}
@Controller('api/v1/admin') @UseGuards(IdentityGuard)
export class AdminController {
  constructor(private readonly service:PlatformService){}
  @Get('overview') async overview(@Req() req:any){const u=await this.service.actor(req.identity);this.service.require(u,'operations.read');const [users,channels,groups]=await Promise.all([this.service.db.user.count(),this.service.db.channel.count(),this.service.db.group.count()]);return {users,channels,groups,stage:'live-development',broadcastingEnabled:(await this.service.settings()).publishingEnabled};}
  @Get('users') async users(@Req() req:any){return this.service.users(await this.service.actor(req.identity));}
  @Patch('users/:id') async user(@Req() req:any,@Param('id') id:string,@Body() body:unknown){const input=z.object({status:z.enum(['active','suspended','disabled']).optional(),groupIds:z.array(uuid).max(100).optional()}).strict().refine(v=>v.status!==undefined||v.groupIds!==undefined).parse(body);return this.service.updateUser(await this.service.actor(req.identity),uuid.parse(id),input);}
  @Patch('channels/:id') async channel(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.approveChannel(await this.service.actor(req.identity),uuid.parse(id),z.object({accessState:z.enum(['ready','disabled','pending_approval'])}).strict().parse(body));}
  @Get('groups') async groups(@Req() req:any){return this.service.groups(await this.service.actor(req.identity));}
  @Get('permissions') async permissions(@Req() req:any){const u=await this.service.actor(req.identity);this.service.require(u,'groups.manage');return this.service.db.permission.findMany({orderBy:{code:'asc'}});}
  @Post('groups') async createGroup(@Req() req:any,@Body() body:unknown){return this.service.saveGroup(await this.service.actor(req.identity),undefined,groupInput.parse(body));}
  @Patch('groups/:id') async updateGroup(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.saveGroup(await this.service.actor(req.identity),uuid.parse(id),groupInput.parse(body));}
  @Get('settings') async settings(@Req() req:any){const u=await this.service.actor(req.identity);this.service.require(u,'settings.manage');return this.service.settings();}
  @Patch('settings') async saveSettings(@Req() req:any,@Body() body:unknown){return this.service.saveSettings(await this.service.actor(req.identity),settingInput.parse(body));}
  @Get('audit') async audit(@Req() req:any){const u=await this.service.actor(req.identity);this.service.require(u,'audit.read');return this.service.db.auditEvent.findMany({take:100,orderBy:{createdAt:'desc'}});}
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error:any,host:ArgumentsHost){const res=host.switchToHttp().getResponse();let status=500,message='The request could not be completed.';
    if(error instanceof HttpException){status=error.getStatus();const r=error.getResponse();message=typeof r==='string'?r:(r as any).message;}
    else if(error instanceof z.ZodError){status=422;message=error.issues.map(i=>`${i.path.join('.')||'input'}: ${i.message}`).join('; ');}
    else if(error?.code==='P2002'){status=409;message='This record already exists.';}
    else if(error?.code==='P2025'){status=404;message='Record not found.';}
    else console.error('Request failed:',error?.name||'Error',error?.code||'');
    res.status(status).json({statusCode:status,message});
  }
}
@Module({controllers:[PublicController,AccountController,AdminController,MediaController,RestreamController,LibraryController,CommunityController,SocialController],providers:[Database,PlatformService,IdentityGuard,OptionalIdentityGuard,MediaService,RestreamService,ChatService,LibraryService,AudienceService,CategoryService,BrandingService,SocialService,AccountService,AnalyticsService,IdentityAdminService]})
export class ApplicationModule {}
