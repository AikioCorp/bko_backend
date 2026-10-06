import sys

file_path = r'c:\Dev\Projet\bamako-Podcast\Bko_backend\src\config\permissions.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('caps: ["view", "create", "edit"] },', 'caps: ["view", "create", "edit", "delete"] },')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
