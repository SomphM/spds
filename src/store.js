import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { database, sql } from './db.js';
import { matches, summarize, dateBounds } from './domain.js';
const columns='Id,TxnTime,CustomerPhone,PackageName,Channel,Status,FailReason,AutoRenewOff,CreatedAt,isFixed,isUser,HandleStatus,HandledByUserId,HandledAt';
const predicate=`(@search='' OR CHARINDEX(@search,CustomerPhone)>0 OR CHARINDEX(@search,PackageName)>0)
  AND (@status='' OR Status=@status) AND (@channel='' OR Channel=@channel)
  AND (@handle='' OR COALESCE(HandleStatus,'pending')=@handle)
  AND (@autoRenew='' OR AutoRenewOff=CASE WHEN @autoRenew='off' THEN 1 ELSE 0 END)
  AND (@failureReason='' OR COALESCE(NULLIF(FailReason,''),'Unspecified')=@failureReason)
  AND (@unresolvedOnly='' OR (Status='failed' AND LOWER(LTRIM(RTRIM(COALESCE(FailReason,''))))<>'balance is not enough' AND COALESCE(HandleStatus,'pending') NOT IN ('fixed','closing')))
  AND CreatedAt>=@startDate AND CreatedAt<@endDate`;
async function requestFor(f) {
  const request=(await database()).request();
  for(const key of ['search','status','channel','handle','failureReason','autoRenew','unresolvedOnly'])request.input(key,sql.NVarChar(200),f[key]);
  const {start,end}=dateBounds(f);
  return request.input('startDate',sql.DateTime2,start).input('endDate',sql.DateTime2,end);
}
export async function createStore(demo) {
  let rows=[];
  if(demo){
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(fileURLToPath(new URL('../demo.xlsx',import.meta.url)));
    const sheet=workbook.worksheets[0],headers=sheet.getRow(1).values;
    sheet.eachRow((row,i)=>{if(i===1)return;const item={};headers.forEach((key,j)=>{let value=row.getCell(j).value;if(value==='NULL'||value==='')value=null;if(['TxnTime','CreatedAt','HandledAt'].includes(key)&&typeof value==='number')value=new Date(Math.round((value-25569)*86400000));item[key]=value;});rows.push(item);});
  }
  return {
    async summary(f){
      if(demo)return summarize(rows.filter(r=>matches(r,f)));
      const result=await (await requestFor(f)).query(`
        SELECT CreatedAt,Status,HandleStatus,AutoRenewOff,Channel,PackageName,FailReason INTO #Metrics FROM dbo.Transactions WHERE ${predicate};
        SELECT COUNT_BIG(*) AS total,
          COALESCE(SUM(CONVERT(bigint,CASE WHEN Status='success' THEN 1 ELSE 0 END)),0) AS success,
          COALESCE(SUM(CONVERT(bigint,CASE WHEN Status='failed' THEN 1 ELSE 0 END)),0) AS failed,
          COALESCE(SUM(CONVERT(bigint,CASE WHEN Status='checking' THEN 1 ELSE 0 END)),0) AS checking,
          COALESCE(SUM(CONVERT(bigint,CASE WHEN Status='failed' AND LOWER(LTRIM(RTRIM(COALESCE(FailReason,''))))<>'balance is not enough' AND COALESCE(HandleStatus,'pending') NOT IN ('fixed','closing') THEN 1 ELSE 0 END)),0) AS unresolved,
          COALESCE(SUM(CONVERT(bigint,CASE WHEN AutoRenewOff=1 THEN 1 ELSE 0 END)),0) AS autoRenewOff,
          COALESCE(SUM(CONVERT(bigint,CASE WHEN AutoRenewOff=1 AND Status='failed' THEN 1 ELSE 0 END)),0) AS failedAutoRenewOff FROM #Metrics;
        SELECT Channel AS name,COUNT_BIG(*) AS count FROM #Metrics GROUP BY Channel ORDER BY count DESC;
        SELECT TOP (6) PackageName AS name,COUNT_BIG(*) AS count FROM #Metrics GROUP BY PackageName ORDER BY count DESC;
        SELECT TOP (6) COALESCE(NULLIF(FailReason,''),'Unspecified') AS name,COUNT_BIG(*) AS count FROM #Metrics WHERE Status='failed' GROUP BY COALESCE(NULLIF(FailReason,''),'Unspecified') ORDER BY count DESC;
        SELECT CONVERT(char(10),CreatedAt,23) AS day,
          SUM(CASE WHEN Status='success' THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN Status='failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN Status='checking' THEN 1 ELSE 0 END) AS checking
          FROM #Metrics GROUP BY CONVERT(char(10),CreatedAt,23) ORDER BY day;
        DROP TABLE #Metrics;`);
      const counts=Object.fromEntries(Object.entries(result.recordsets[0][0]).map(([k,v])=>[k,Number(v)]));
      return {...counts,successRate:counts.total?counts.success/counts.total*100:0,channels:result.recordsets[1],packages:result.recordsets[2],failures:result.recordsets[3],trend:result.recordsets[4]};
    },
    async rows(f,pagination={page:1,pageSize:25}){
      const {page,pageSize}=pagination;
      if(demo){const filtered=rows.filter(r=>matches(r,f)).sort((a,b)=>new Date(b.CreatedAt)-new Date(a.CreatedAt)||Number(b.Id)-Number(a.Id));return {items:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,...pagination};}
      const request=await requestFor(f);request.input('first',sql.BigInt,(page-1)*pageSize+1).input('last',sql.BigInt,page*pageSize);
      const result=await request.query(`
        WITH Paged AS (SELECT ${columns},ROW_NUMBER() OVER(ORDER BY CreatedAt DESC,Id DESC) AS RowNumber FROM dbo.Transactions WHERE ${predicate})
        SELECT ${columns} FROM Paged WHERE RowNumber BETWEEN @first AND @last ORDER BY RowNumber;
        SELECT COUNT_BIG(*) AS Total FROM dbo.Transactions WHERE ${predicate};`);
      return {items:result.recordsets[0],total:Number(result.recordsets[1][0].Total),...pagination};
    },
    async options(){if(demo)return [...new Set(rows.map(r=>r.Channel))].sort();return (await (await database()).request().query('SELECT DISTINCT Channel FROM dbo.Transactions ORDER BY Channel')).recordset.map(r=>r.Channel);},
    async alerts(f){
      if(demo){
        const relevant=rows.filter(r=>matches(r,{from:f.from,to:f.to})&&r.Status==='failed'&&(r.FailReason||'').trim().toLowerCase()!=='balance is not enough').sort((a,b)=>new Date(b.CreatedAt)-new Date(a.CreatedAt)||Number(b.Id)-Number(a.Id));
        return {items:relevant.slice(0,20).map(r=>({Id:r.Id,AlertTime:r.CreatedAt,Level:'failed',Message:r.FailReason||'Unspecified',PackageName:r.PackageName,Status:r.Status})),total:relevant.length};
      }
      const {start,end}=dateBounds(f);
      const result=await (await database()).request().input('start',sql.DateTime2,start).input('end',sql.DateTime2,end).query(`
        SELECT TOP (20) Id,CreatedAt AS AlertTime,'failed' AS Level,COALESCE(NULLIF(FailReason,''),'Unspecified') AS Message,PackageName,Status,COUNT_BIG(*) OVER() AS Total
        FROM dbo.Transactions WHERE CreatedAt>=@start AND CreatedAt<@end AND Status='failed'
        AND LOWER(LTRIM(RTRIM(COALESCE(FailReason,''))))<>'balance is not enough'
        ORDER BY CreatedAt DESC,Id DESC`);
      return {items:result.recordset,total:Number(result.recordset[0]?.Total||0)};
    },
    async transaction(id) {
      if(demo)return rows.find(row=>String(row.Id)===id);
      return (await (await database()).request().input('id',sql.BigInt,id).query(`
        SELECT ${columns.split(',').map(column=>'t.'+column).join(',')},
          COALESCE(NULLIF(LTRIM(RTRIM(u.DisplayName)),''),u.Username) AS HandledByDisplayName
        FROM dbo.Transactions AS t
        LEFT JOIN dbo.Users AS u ON u.Id=t.HandledByUserId
        WHERE t.Id=@id`)).recordset[0];
    },
    async user(username) { return (await (await database()).request().input('name',sql.VarChar(50),username).query('SELECT TOP (1) Id,Username,DisplayName,PasswordHash,PasswordSalt FROM dbo.Users WHERE Username=@name')).recordset[0]; },
    async update(id,status,userId) {
      if (demo) { const row = rows.find(r=>String(r.Id)===id); if (!row) return false; if(status==='fixed')row.AutoRenewOff=false; Object.assign(row,{HandleStatus:status,isFixed:status==='fixed'?1:0,HandledAt:new Date(),HandledByUserId:userId}); return true; }
      return !!(await (await database()).request().input('id',sql.BigInt,id).input('status',sql.VarChar(20),status).input('user',sql.Int,userId).query("UPDATE dbo.Transactions SET HandleStatus=@status,AutoRenewOff=CASE WHEN @status='fixed' THEN 0 ELSE AutoRenewOff END,isFixed=CASE WHEN @status='fixed' THEN 1 ELSE 0 END,HandledByUserId=@user,HandledAt=SYSUTCDATETIME() WHERE Id=@id")).rowsAffected[0];
    }
  };
}
