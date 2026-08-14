# Self-test prompt

Send this as the first message of a session on a preset (or profile) with the
toolkit rows (`vision`, `native-web`) to verify the integration end to end. It
exercises search, scrape and vision, and asks for an explicit report instead
of silently skipping anything.

```markdown
请对 dsh-enhance 工具集做一次完整自检并报告结果：

1. 用 native_search 搜索 "DeepSeek latest news"，报告返回的 top 3 结果（标题/URL/描述）；
2. 用 native_search 结果中最有价值的一页 URL 调用 native_scrape，报告抓到的内容长度和开头几行；
3. 用 vision_list_models 列出可用模型；然后用 vision_describe 分析本地文件 /tmp/vision-test.png（先生成一张：红蓝背景、中间白色矩形、内含黑色矩形的测试图），报告识别结果；
4. 最后总结：每个工具是否可用、耗时、有无异常。

如果某个工具不可用或调用失败，明确说出工具名和错误信息，不要自行跳过。
```

## Expected outcome

| Tool | Expected |
|---|---|
| `native_search` | 3+ ranked results with title/url/description |
| `native_scrape` | clean markdown of the target page, or an explicit instance-side empty-content note (see [known-limitations.md](known-limitations.md)) |
| `vision_list_models` | the endpoint's model ids |
| `vision_describe` | a correct description of the generated test image |
