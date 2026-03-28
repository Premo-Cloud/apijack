export const commandMap = {
    'admin list': { operationId: 'listAdmins', pathParams: [], queryParams: [], hasBody: false, description: 'List admins' },
    'admin create': { operationId: 'createAdmin', pathParams: [], queryParams: [], hasBody: true },
    'matters list': { operationId: 'listMatters', pathParams: [], queryParams: ['page'], hasBody: false, description: 'List matters' },
    'matters get': { operationId: 'getMatter', pathParams: ['id'], queryParams: [], hasBody: false },
};
