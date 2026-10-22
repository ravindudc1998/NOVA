import {Controller,Delete,Get,HttpCode,Param,Put,Req,UseGuards} from '@nestjs/common';
import {z} from 'zod';
import {IdentityGuard} from './auth.js';
import {LibraryService} from './library.service.js';
const uuid=z.string().uuid();

@Controller('api/v1/me/library') @UseGuards(IdentityGuard)
export class LibraryController {
 constructor(private readonly library:LibraryService){}
 @Get() read(@Req() req:any){return this.library.read(req.identity);}
 @Put('favourites/:id') @HttpCode(200) add(@Req() req:any,@Param('id') id:string){return this.library.favourite(req.identity,uuid.parse(id),true);}
 @Delete('favourites/:id') @HttpCode(200) remove(@Req() req:any,@Param('id') id:string){return this.library.favourite(req.identity,uuid.parse(id),false);}
 @Put('recents/:id') @HttpCode(200) visited(@Req() req:any,@Param('id') id:string){return this.library.visited(req.identity,uuid.parse(id));}
}
