#!/usr/bin/env python3
import json

# Read the test.http file and extract the JSON body
with open('./http/test.http', 'r') as f:
    content = f.read()

# Find the JSON part (starts after the headers)
lines = content.split('\n')
json_start = -1
for i, line in enumerate(lines):
    if line.strip().startswith('{"model"'):
        json_start = i
        break

if json_start != -1:
    json_content = '\n'.join(lines[json_start:])
    try:
        data = json.loads(json_content)
        
        # Look for messages
        if 'messages' in data:
            print("Messages found:")
            for i, msg in enumerate(data['messages']):
                print(f"\nMessage {i}:")
                print(f"Role: {msg.get('role')}")
                if 'content' in msg:
                    if isinstance(msg['content'], list):
                        print(f"Content blocks: {len(msg['content'])}")
                        for j, block in enumerate(msg['content']):
                            print(f"  Block {j}: type={block.get('type')}")
                            if block.get('type') == 'tool_result':
                                print(f"    tool_use_id: {block.get('tool_use_id')}")
                    else:
                        print(f"Content: {msg['content'][:100]}...")
        else:
            print("No messages found in the request")
            print("Available keys:", data.keys())
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON: {e}")
else:
    print("Could not find JSON content in test.http file")