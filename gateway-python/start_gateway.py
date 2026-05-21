"""启动CaseBuddy Python网关（用于解决中文路径问题）"""
import subprocess, sys, os
from pathlib import Path

gateway_dir = Path(r"D:\wrw组会\MBA案例分析\MBA案例分析\casebuddy\gateway-python")
log_path = Path(r"D:\wrw组会\MBA案例分析\MBA案例分析\gateway_python3.log")

print(f"启动网关: {gateway_dir / 'gateway_server.py'}")
print(f"日志: {log_path}")

with open(log_path, 'w', encoding='utf-8') as logf:
    proc = subprocess.Popen(
        [sys.executable, str(gateway_dir / 'gateway_server.py')],
        cwd=str(gateway_dir),
        stdout=logf,
        stderr=logf,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
    )
    print(f"PID: {proc.pid}")
    
# 写入PID文件
(gateway_dir / 'gateway.pid').write_text(str(proc.pid))
print("Done")
