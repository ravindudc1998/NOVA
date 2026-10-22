import {Body,Controller,Delete,Get,Param,Patch,Post,Put,Req,Res,UploadedFile,UseGuards,UseInterceptors,HttpCode} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {z} from 'zod';
import {IdentityGuard} from './auth.js';
import {PlatformService} from './platform.service.js';
import {CategoryService} from './category.service.js';
import {BrandingService} from './branding.service.js';
import {ChatService} from './chat.service.js';
const uuid=z.string().uuid(),kind=z.enum(['avatar','banner','offline']);
const categoryInput=z.object({name:z.string().trim().min(1).max(50),slug:z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),description:z.string().trim().max(300).default(''),enabled:z.boolean(),version:z.number().int().min(1).optional()}).strict();
@Controller('api/v1')
export class CommunityController {
 constructor(readonly platform:PlatformService,readonly categories:CategoryService,readonly branding:BrandingService,readonly chat:ChatService){}
 @Get('admin/channels') @UseGuards(IdentityGuard) async channels(@Req() req:any){this.platform.require(await this.platform.actor(req.identity),'channels.manage_any');return this.platform.db.channel.findMany({orderBy:{createdAt:'desc'},take:200,include:{owner:{select:{username:true,displayName:true}},category:true}});}
 @Patch('admin/channels/:id/details') @UseGuards(IdentityGuard) async channelDetails(@Req() req:any,@Param('id') id:string,@Body() body:unknown){const input=z.object({version:z.number().int().positive(),title:z.string().trim().min(1).max(100),bio:z.string().max(500),settings:z.object({category:z.string().trim().min(1).max(50)}).strict()}).strict().parse(body);return this.platform.updateStudio(await this.platform.actor(req.identity),input,uuid.parse(id));}
 @Get('categories') list(){return this.categories.list();}
 @Get('admin/categories') @UseGuards(IdentityGuard) async adminCategories(@Req() req:any){this.platform.require(await this.platform.actor(req.identity),'categories.manage');return this.categories.list(true);}
 @Post('admin/categories') @UseGuards(IdentityGuard) async createCategory(@Req() req:any,@Body() body:unknown){return this.categories.save(await this.platform.actor(req.identity),undefined,categoryInput.parse(body));}
 @Patch('admin/categories/:id') @UseGuards(IdentityGuard) async updateCategory(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.categories.save(await this.platform.actor(req.identity),uuid.parse(id),categoryInput.parse(body));}
 @Get('channels/:id/branding/:kind') image(@Param('id') id:string,@Param('kind') asset:string,@Res() res:any){return this.branding.read(uuid.parse(id),kind.parse(asset),res);}
 @Get('channels/:id/branding/:kind/preview') @UseGuards(IdentityGuard) async preview(@Req() req:any,@Param('id') id:string,@Param('kind') asset:string,@Res() res:any){return this.branding.read(uuid.parse(id),kind.parse(asset),res,await this.platform.actor(req.identity));}
 @Get('channels/:id/branding') @UseGuards(IdentityGuard) async brandingInfo(@Req() req:any,@Param('id') id:string){return this.branding.metadata(await this.platform.actor(req.identity),uuid.parse(id));}
 @Put('channels/:id/branding/:kind') @UseGuards(IdentityGuard) @UseInterceptors(FileInterceptor('image',{limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1}})) async upload(@Req() req:any,@Param('id') id:string,@Param('kind') asset:string,@UploadedFile() file:any){return this.branding.put(await this.platform.actor(req.identity),uuid.parse(id),kind.parse(asset),file);}
 @Delete('channels/:id/branding/:kind') @UseGuards(IdentityGuard) async removeImage(@Req() req:any,@Param('id') id:string,@Param('kind') asset:string){return this.branding.remove(await this.platform.actor(req.identity),uuid.parse(id),kind.parse(asset));}
 @Get('channels/:id/moderation') @UseGuards(IdentityGuard) moderation(@Req() req:any,@Param('id') id:string){return this.chat.moderation(req.identity,uuid.parse(id));}
 @Put('channels/:id/moderation/rules') @UseGuards(IdentityGuard) rules(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.chat.saveRules(req.identity,uuid.parse(id),z.object({version:z.number().int().min(0),blockedWords:z.array(z.string().trim().min(1).max(50)).max(100)}).strict().parse(body));}
 @Put('channels/:id/moderation/users/:user') @UseGuards(IdentityGuard) restrict(@Req() req:any,@Param('id') id:string,@Param('user') user:string,@Body() body:unknown){return this.chat.restrict(req.identity,uuid.parse(id),uuid.parse(user),z.object({kind:z.enum(['ban','timeout']),seconds:z.number().int().min(30).max(604800).optional(),reason:z.string().trim().max(300).default('')}).strict().refine(value=>value.kind==='ban'||value.seconds!==undefined,{message:'A timeout needs a duration.'}).parse(body));}
 @Delete('channels/:id/moderation/users/:user') @UseGuards(IdentityGuard) lift(@Req() req:any,@Param('id') id:string,@Param('user') user:string){return this.chat.lift(req.identity,uuid.parse(id),uuid.parse(user));}
 @Post('channels/:id/moderation/moderators') @UseGuards(IdentityGuard) moderator(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.chat.moderator(req.identity,uuid.parse(id),z.object({username:z.string().trim().toLowerCase().min(3).max(25)}).strict().parse(body).username,true);}
 @Delete('channels/:id/moderation/moderators/:user') @UseGuards(IdentityGuard) removeModerator(@Req() req:any,@Param('id') id:string,@Param('user') user:string){return this.chat.moderator(req.identity,uuid.parse(id),uuid.parse(user),false);}
 @Post('channels/:id/chat/:message/reports') @HttpCode(200) @UseGuards(IdentityGuard) report(@Req() req:any,@Param('id') id:string,@Param('message') message:string,@Body() body:unknown){return this.chat.report(req.identity,uuid.parse(id),z.coerce.number().int().positive().parse(message),z.object({reason:z.enum(['spam','harassment','hate','other']),details:z.string().trim().max(500).default('')}).strict().parse(body));}
 @Patch('channels/:id/reports/:report') @UseGuards(IdentityGuard) review(@Req() req:any,@Param('id') id:string,@Param('report') report:string,@Body() body:unknown){return this.chat.review(req.identity,uuid.parse(id),uuid.parse(report),z.object({status:z.enum(['resolved','dismissed']),resolution:z.string().trim().max(300).default('')}).strict().parse(body));}
 @Get('admin/chat-reports') @UseGuards(IdentityGuard) reports(@Req() req:any){return this.chat.reports(req.identity);}
}
