# Third-party components

The MIT license at the repository root covers NOVA-owned application code and these project guides. It does not replace licenses for third-party packages, services, codecs or base images. This source export does not include installed dependency trees, compiled images, user data or the earlier prototype's stock artwork.

Direct runtime package license declarations were checked against the installed package metadata during preparation:

| Packages | Declared license |
| --- | --- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | MIT |
| `react`, `react-dom`, `pg`, `jose`, `zod` | MIT |
| `@prisma/client`, `@prisma/adapter-pg`, `hls.js`, `keycloak-js`, `sharp`, `rxjs`, `reflect-metadata` | Apache-2.0 |

For exact versions and transitive packages, inspect `nova-platform/package-lock.json` and the notices delivered with installed packages. This short inventory is not a substitute for those license texts.

Container services and system packages retain their upstream notices. The Dockerfile/Compose manifest record image names, versions and digests. In particular, FFmpeg's applicable license depends on the enabled components; GPL components such as libx264 affect its build license. Refer to the [FFmpeg licensing information](https://ffmpeg.org/legal.html) and the actual installed packages/build configuration before redistributing binaries or container images.

The source license does not grant rights to third-party trademarks, or represent clearance for every codec/patent use or binary redistribution. No hosted binary release is included here.
