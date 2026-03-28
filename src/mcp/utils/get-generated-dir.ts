import { resolve, dirname } from 'path';
import { findProjectConfig, loadProjectConfig } from '../../project';
import type { McpContext } from '../types';

export function getGeneratedDir(ctx: McpContext): string {
    if (ctx.projectRoot) {
        const projectConfigPath = findProjectConfig(ctx.projectRoot);
        if (projectConfigPath) {
            const projectConfig = loadProjectConfig(projectConfigPath);
            const projectRoot = dirname(projectConfigPath);
            if (projectConfig?.generatedDir) {
                return resolve(projectRoot, projectConfig.generatedDir);
            }
            return resolve(projectRoot, '.apijack', 'generated');
        }
    }
    return ctx.generatedDir;
}
