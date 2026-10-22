import {Body,Controller,Delete,Get,HttpCode,Param,Patch,Post,Put,Query,Req,Res,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {IdentityGuard} from './auth.js';
import {AccountService} from './account.service.js';
import {SocialService} from './social.service.js';
import {AnalyticsService} from './analytics.service.js';
const uuid=z.string().uuid(),page=z.coerce.number().int().min(1).max(100000).default(1),days=z.coerce.number().refine(value=>value===7||value===30).default(7);
@Controller('api/v1') @UseGuards(IdentityGuard)
export class SocialController {
 constructor(readonly social:SocialService,readonly analytics:AnalyticsService,readonly accountService:AccountService){}
 @Get('me/follows') follows(@Req() req:any){return this.social.follows(req.identity);}
 @Put('me/follows/:id') follow(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.social.follow(req.identity,uuid.parse(id),true,z.object({notifyLive:z.boolean().optional()}).strict().parse(body||{}).notifyLive);}
 @Delete('me/follows/:id') unfollow(@Req() req:any,@Param('id') id:string){return this.social.follow(req.identity,uuid.parse(id),false);}
 @Patch('me/follows/:id') alerts(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.social.alerts(req.identity,uuid.parse(id),z.object({notifyLive:z.boolean()}).strict().parse(body).notifyLive);}
 @Get('me/notifications') notifications(@Req() req:any,@Query('cursor') cursor?:string){return this.social.notifications(req.identity,cursor?uuid.parse(cursor):undefined);}
 @Get('me/notifications/events') events(@Req() req:any,@Res() res:any){return this.social.events(req.identity,res);}
 @Post('me/notifications/read-all') @HttpCode(200) readAll(@Req() req:any){return this.social.read(req.identity);}
 @Post('me/notifications/:id/read') @HttpCode(200) read(@Req() req:any,@Param('id') id:string){return this.social.read(req.identity,uuid.parse(id));}
 @Get('me/analytics') ownAnalytics(@Req() req:any,@Query('days') period?:string,@Query('page') index?:string){return this.analytics.report(req.identity,days.parse(period),page.parse(index));}
 @Get('admin/analytics') allAnalytics(@Req() req:any,@Query('days') period?:string,@Query('page') index?:string,@Query('channel') channel?:string){return this.analytics.report(req.identity,days.parse(period),page.parse(index),true,channel?uuid.parse(channel):undefined);}
 @Patch('me/profile') profile(@Req() req:any,@Body() body:unknown){return this.accountService.profile(req.identity,z.object({version:z.number().int().positive(),displayName:z.string().trim().min(1).max(80),bio:z.string().trim().max(500)}).strict().parse(body));}
 @Post('me/upgrade') @HttpCode(200) upgrade(@Req() req:any){return this.accountService.upgrade(req.identity);}
 @Get('me/sessions') sessions(@Req() req:any){return this.accountService.sessions(req.identity);}
 @Post('me/sessions/revoke') @HttpCode(200) revoke(@Req() req:any,@Body() body:unknown){return this.accountService.revoke(req.identity,z.object({sessionId:z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/).optional(),others:z.boolean().optional()}).strict().refine(value=>!value.sessionId||!value.others).parse(body||{}));}
 @Get('admin/accounts') accounts(@Req() req:any,@Query() query:any){const input=z.object({page,query:z.string().trim().max(80).default(''),status:z.enum(['active','suspended','disabled']).optional(),groupId:uuid.optional()}).strict().parse(query);return this.accountService.list(req.identity,input);}
 @Post('admin/accounts') create(@Req() req:any,@Body() body:unknown){return this.accountService.create(req.identity,z.object({username:z.string().trim().min(3).max(25),displayName:z.string().trim().min(1).max(80),accountType:z.enum(['viewer','creator'])}).strict().parse(body));}
 @Post('admin/accounts/:id/upgrade') @HttpCode(200) adminUpgrade(@Req() req:any,@Param('id') id:string){return this.accountService.upgrade(req.identity,uuid.parse(id));}
 @Post('admin/accounts/:id/password-reset') @HttpCode(200) reset(@Req() req:any,@Param('id') id:string){return this.accountService.resetPassword(req.identity,uuid.parse(id));}
 @Get('admin/accounts/:id/sessions') adminSessions(@Req() req:any,@Param('id') id:string){return this.accountService.sessions(req.identity,uuid.parse(id));}
 @Post('admin/accounts/:id/sessions/revoke') @HttpCode(200) adminRevoke(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.accountService.revoke(req.identity,z.object({sessionId:z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/).optional()}).strict().parse(body||{}),uuid.parse(id));}
}
